import { NextRequest, NextResponse } from "next/server";

/* POST /api/auth — 校验管理密码，通过后设置 cookie */
export async function POST(req: NextRequest) {
  try {
    const { password } = await req.json();
    const correct = process.env.ADMIN_PASSWORD;

    if (!correct) {
      return NextResponse.json({ error: "服务端未配置管理密码" }, { status: 500 });
    }

    if (password !== correct) {
      return NextResponse.json({ error: "密码错误" }, { status: 401 });
    }

    const res = NextResponse.json({ success: true });
    res.cookies.set("admin_auth", "1", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24,
    });
    return res;
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
}

/* GET /api/auth — 检查当前是否已登录 */
export async function GET(req: NextRequest) {
  const cookie = req.cookies.get("admin_auth");
  return NextResponse.json({ authenticated: cookie?.value === "1" });
}
