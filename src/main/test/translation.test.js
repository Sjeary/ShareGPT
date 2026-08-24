const test = require("node:test");
const assert = require("node:assert/strict");

const {
  assertOfflineEndpoint,
  isLoopbackHostname,
  translatedTextFromResponse,
  translationEndpoint,
} = require("../translation");

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
  assert.throws(() => assertOfflineEndpoint("https://translate.example"), /回环地址/);
});

test("translation endpoints reject unsupported protocols", () => {
  assert.throws(() => translationEndpoint("file:///tmp/translation"), /HTTP/);
});

test("translatedTextFromResponse supports common compatible payloads", () => {
  assert.equal(translatedTextFromResponse({ translatedText: "你好" }), "你好");
  assert.equal(translatedTextFromResponse({ translation: "你好" }), "你好");
  assert.equal(translatedTextFromResponse({ translations: [{ text: "你好" }] }), "你好");
});
