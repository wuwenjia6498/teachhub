import type { NextRequest } from "next/server";

/**
 * 统一的管理员鉴权判断：检查 httpOnly cookie `admin_auth=1`
 *
 * 只要通过 /api/auth 用正确密码登录过，cookie 就会被下发。
 * 写接口（上传 / 删除 / 编辑）都应调用本函数，确保非管理员无法直接调 API。
 *
 * 单一函数而非 middleware：好处是每个路由可以自行决定鉴权范围，
 * 不会因为 matcher 拼错误伤公共接口。
 */
export function isAdmin(req: NextRequest): boolean {
  return req.cookies.get("admin_auth")?.value === "1";
}
