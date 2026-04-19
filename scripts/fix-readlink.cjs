/**
 * Windows 专用 Node.js fs.readlink 补丁
 * --------------------------------------------------------------------------
 * 问题：Node.js 在 Windows 上对"普通文件"调用 readlink 会抛出 EISDIR，
 *      而 Linux/macOS 上会抛 EINVAL。webpack / 某些 Next.js 内部工具
 *      只认 EINVAL，遇到 EISDIR 就会直接崩溃。
 *      参见 https://github.com/nodejs/node/issues/15880
 *
 * 本补丁把 readlink 的 EISDIR 错误翻译成 EINVAL，让上层工具能正确降级。
 * 仅在 win32 平台启用；Linux/macOS（例如 Vercel 部署环境）自动 no-op。
 *
 * 通过 NODE_OPTIONS="--require ./scripts/fix-readlink.cjs" 在 build 脚本里加载。
 */
if (process.platform !== "win32") return;

const fs = require("fs");

function toEinval(err, path) {
  if (!err || err.code !== "EISDIR") return err;
  const einval = new Error(`EINVAL: invalid argument, readlink '${path}'`);
  einval.code = "EINVAL";
  einval.errno = -4071;
  einval.syscall = "readlink";
  einval.path = path;
  return einval;
}

/* 同步版本 */
const origReadlinkSync = fs.readlinkSync;
fs.readlinkSync = function patchedReadlinkSync(path, options) {
  try {
    return origReadlinkSync.call(fs, path, options);
  } catch (err) {
    throw toEinval(err, path);
  }
};

/* 回调版本 */
const origReadlink = fs.readlink;
fs.readlink = function patchedReadlink(path, options, cb) {
  if (typeof options === "function") {
    cb = options;
    options = undefined;
  }
  origReadlink.call(fs, path, options, (err, link) => {
    if (err) return cb(toEinval(err, path));
    cb(null, link);
  });
};

/* Promise 版本 */
if (fs.promises && fs.promises.readlink) {
  const origReadlinkP = fs.promises.readlink;
  fs.promises.readlink = async function patchedReadlinkP(path, options) {
    try {
      return await origReadlinkP.call(fs.promises, path, options);
    } catch (err) {
      throw toEinval(err, path);
    }
  };
}
