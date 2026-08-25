const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");

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
  assert.throws(() => translationEndpoint("http://translate.example"), /必须使用 HTTPS/);
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
