const js = require("@eslint/js");
const globals = require("globals");

// 根级 ESLint (flat config)。只 lint Node 端 JS:
//   - src/main/**/*.js (Electron 主进程)
//   - collab_server2/**/*.js (协作服务端)
//   - scripts/**/*.mjs (构建脚本)
// 其余目录 (渲染层 src/renderer-next、admin_console、旧 src/renderer 等)
// 各自有独立配置或无需在此 lint, 全部忽略。
module.exports = [
  {
    // 只保留三类目标文件, 其它一律忽略 (含本配置文件自身)。
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "release*/**",
      "build/bin/**",
      "src/renderer/**",
      "src/renderer-next/**",
      "admin_console/**",
      "eslint.config.js",
    ],
  },
  {
    files: ["src/main/**/*.js", "collab_server2/**/*.js"],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: {
        ...globals.node,
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      "no-unused-vars": "warn",
      // 以下规则在当前 Node 端代码中均为有意写法 (空 catch 忽略错误、
      // 含控制字符的清洗用正则等), 降级为 warn 以保持可见但不阻断 lint。
      "no-empty": "warn",
      "no-control-regex": "warn",
      "preserve-caught-error": "warn",
      "no-extra-boolean-cast": "warn",
      "no-case-declarations": "warn",
    },
  },
  {
    files: ["scripts/**/*.mjs"],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      "no-unused-vars": "warn",
      // 以下规则在当前 Node 端代码中均为有意写法 (空 catch 忽略错误、
      // 含控制字符的清洗用正则等), 降级为 warn 以保持可见但不阻断 lint。
      "no-empty": "warn",
      "no-control-regex": "warn",
      "preserve-caught-error": "warn",
      "no-extra-boolean-cast": "warn",
      "no-case-declarations": "warn",
    },
  },
];
