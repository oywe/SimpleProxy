import { serve } from "https://deno.land/std@0.208.0/http/server.ts";

// 簡易クッキー管理
const cookieStore = new Map<string, string>(); // key: URLホスト, value: cookie文字列

function rewriteLinks(html: string, proxyBase: string) {
  html = html.replace(/href="(https?:\/\/[^"]+)"/g, `href="${proxyBase}?u=$1"`);
  html = html.replace(/src="(https?:\/\/[^"]+)"/g, `src="${proxyBase}?u=$1"`);
  html = html.replace(/<link[^>]+href="(https?:\/\/[^"]+)"/g, (m, p1) =>
    m.replace(p1, `${proxyBase}?u=${p1}`)
  );
  html = html.replace(/<script[^>]+src="(https?:\/\/[^"]+)"/g, (m, p1) =>
    m.replace(p1, `${proxyBase}?u=${p1}`)
  );
  return html;
}

serve(async (req) => {
  const urlObj = new URL(req.url);
  const target = urlObj.searchParams.get("u");
  if (!target) return new Response("Missing url param", { status: 400 });

  try {
    const tUrl = new URL(target);

    // 元サイトに送るクッキーをセット
    const headers = new Headers();
    const storedCookie = cookieStore.get(tUrl.host);
    if (storedCookie) headers.set("cookie", storedCookie);

    const r = await fetch(target, { headers });

    // 受け取った Set-Cookie を保存
    const setCookie = r.headers.get("set-cookie");
    if (setCookie) cookieStore.set(tUrl.host, setCookie);

    const contentType = r.headers.get("content-type") || "";

    if (contentType.includes("text/html")) {
      let html = await r.text();
      const proxyBase = `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`;
      html = rewriteLinks(html, proxyBase);
      return new Response(html, {
        headers: { "Content-Type": "text/html; charset=UTF-8" },
      });
    } else {
      const body = await r.arrayBuffer();
      return new Response(body, { headers: { "Content-Type": contentType } });
    }
  } catch (e) {
    return new Response(String(e), { status: 500 });
  }
});
