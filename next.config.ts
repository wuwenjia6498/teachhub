import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Windows 下 webpack 构建时绕开 Node.js 的 readlink 历史问题：
   * https://github.com/nodejs/node/issues/15880
   * 项目内不使用符号链接，关掉 symlink 解析能避免 EISDIR 报错。
   */
  webpack: (config) => {
    config.resolve = config.resolve ?? {};
    config.resolve.symlinks = false;
    return config;
  },
};

export default nextConfig;
