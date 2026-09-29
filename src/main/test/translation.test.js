const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const http = require("node:http");

const {
  assertOfflineEndpoint,
  isLoopbackHostname,
  translatedTextFromResponse,
  translateText,
  translationEndpoint,
} = require("../translation");

function responseRequest(payload, inspectOptions = Function.prototype) {
  return (options, callback) => {
    inspectOptions(options);
    const request = /** @type {any} */ (new EventEmitter());
    request.destroy = (error) => {
      if (error) request.emit("error", error);
    };
    request.end = () => {
      const response = /** @type {any} */ (new PassThrough());
      response.statusCode = 200;
      callback(response);
      response.end(JSON.stringify(payload));
    };
    return request;
  };
}

test("translationEndpoint appends the LibreTranslate path", () => {
  assert.equal(
    translationEndpoint("https://translate.example/v1").href,
    "https://translate.example/v1/translate",
  );
  assert.equal(
    translationEndpoint("https://translate.example/translate").href,
    "https://translate.example/translate",
  );
});

test("offline translation accepts loopback hosts only", () => {
  assert.equal(isLoopbackHostname("localhost"), true);
  assert.equal(isLoopbackHostname("127.0.0.1"), true);
  assert.equal(isLoopbackHostname("::1"), true);
  assert.equal(assertOfflineEndpoint("http://127.0.0.1:5000").port, "5000");
  assert.throws(() => assertOfflineEndpoint("https://translate.example"), /只允许连接/);
});

test("translation endpoints reject unsupported protocols", () => {
  assert.throws(() => translationEndpoint("file:///tmp/translation"), /HTTP/);
  assert.equal(translationEndpoint("http://translate.example").protocol, "http:");
});

test("translatedTextFromResponse supports common compatible payloads", () => {
  assert.equal(translatedTextFromResponse({ translatedText: "你好" }), "你好");
  assert.equal(translatedTextFromResponse({ translation: "你好" }), "你好");
  assert.equal(translatedTextFromResponse({ translations: [{ text: "你好" }] }), "你好");
});

test("translation pins the validated address while preserving hostname and SNI", async () => {
  /** @type {any} */
  let requestOptions;
  const result = await translateText(
    {
      mode: "api",
      baseUrl: "https://translate.example/v1",
      text: "hello",
      target: "zh",
    },
    {
      lookup: async () => [{ address: "93.184.216.34", family: 4 }],
      httpsRequest: responseRequest({ translatedText: "你好" }, (options) => {
        requestOptions = options;
      }),
    },
  );
  assert.deepEqual(result, { translatedText: "你好" });
  assert.ok(requestOptions);
  assert.equal(requestOptions.hostname, "translate.example");
  assert.equal(requestOptions.servername, "translate.example");
  await new Promise((resolve, reject) => {
    requestOptions.lookup("translate.example", {}, (error, address, family) => {
      if (error) reject(error);
      else {
        assert.equal(address, "93.184.216.34");
        assert.equal(family, 4);
        resolve();
      }
    });
  });
});

test("translation rejects mixed public and private DNS answers", async () => {
  await assert.rejects(
    translateText(
      { mode: "api", baseUrl: "https://translate.example", text: "hello" },
      {
        lookup: async () => [
          { address: "93.184.216.34", family: 4 },
          { address: "10.0.0.2", family: 4 },
        ],
        httpsRequest: () => {
          throw new Error("must not request");
        },
      },
    ),
    /禁止访问/,
  );
});

test("translation abort destroys the active request and rejects once", async () => {
  const controller = new AbortController();
  let destroyed = 0;
  const pendingRequest = (options, callback) => {
    void options;
    void callback;
    const request = /** @type {any} */ (new EventEmitter());
    request.end = () => undefined;
    request.destroy = (error) => {
      destroyed += 1;
      request.emit("error", error);
    };
    return request;
  };

  const promise = translateText(
    { mode: "api", baseUrl: "https://translate.example", text: "hello" },
    {
      signal: controller.signal,
      lookup: async () => [{ address: "93.184.216.34", family: 4 }],
      httpsRequest: pendingRequest,
    },
  );
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();

  await assert.rejects(promise, (error) => error instanceof Error && error.name === "AbortError");
  assert.equal(destroyed, 1);
});

test("translation rejects an already aborted request before DNS or network access", async () => {
  const controller = new AbortController();
  controller.abort();
  let lookupCalled = false;

  await assert.rejects(
    translateText(
      { mode: "api", baseUrl: "https://translate.example", text: "hello" },
      {
        signal: controller.signal,
        lookup: async () => {
          lookupCalled = true;
          return [{ address: "93.184.216.34", family: 4 }];
        },
      },
    ),
    (error) => error instanceof Error && error.name === "AbortError",
  );
  assert.equal(lookupCalled, false);
});

for (const responseEvent of ["aborted", "error", "close"]) {
  test(`translation rejects a partial response on ${responseEvent}`, async () => {
    await assert.rejects(
      translateText(
        { baseUrl: "https://translate.example", text: "hello" },
        {
          lookup: async () => [{ address: "93.184.216.34", family: 4 }],
          httpsRequest: (_options, callback) => {
            const request = /** @type {any} */ (new EventEmitter());
            request.destroy = () => {};
            request.end = () => {
              const response = /** @type {any} */ (new PassThrough());
              response.statusCode = 200;
              callback(response);
              response.write('{"translatedText":"part');
              response.emit(responseEvent, new Error("connection reset"));
              response.emit("error", new Error("late response error"));
              response.emit("close");
              request.emit("error", new Error("late request error"));
            };
            return request;
          },
        },
      ),
      /连接中断|connection reset/,
    );
  });
}

test(
  "translation rejects a real socket disconnect after response headers",
  { timeout: 5000 },
  async (t) => {
    const server = http.createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "application/json", "Content-Length": "1000" });
      response.write('{"translatedText":"partial');
      setImmediate(() => response.socket?.destroy());
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => server.close());
    const address = /** @type {import("node:net").AddressInfo} */ (server.address());
    await assert.rejects(
      translateText({
        mode: "offline",
        baseUrl: `http://127.0.0.1:${address.port}`,
        text: "hello",
      }),
      /连接中断|aborted|socket hang up/,
    );
  },
);
