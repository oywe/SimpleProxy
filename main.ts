import { serve } from "https://deno.land/std@0.208.0/http/server.ts";

// Deno Deployが設定するPORT環境変数を取得し、ローカル実行用に8000をデフォルト値とする
const port = parseInt(Deno.env.get("PORT") ?? "8000");

// 簡易クッキー管理 (グローバル変数としてサーバー全体で共有される)
const cookieStore = new Map<string, string>(); // key: URLホスト, value: cookie文字列

/**
 * HTML内のリンクとリソースのURLをプロキシ経由のURLに書き換える関数
 * @param html - 書き換え対象のHTML文字列
 * @param proxyBase - プロキシサーバーのベースURL (例: http://localhost:8000/)
 * @returns リンクが書き換えられたHTML文字列
 */
function rewriteLinks(html: string, proxyBase: string): string {
  // 1. href属性を持つリンク (<a>, <link>など)
  html = html.replace(/href="(https?:\/\/[^"]+)"/g, `href="${proxyBase}?u=$1"`);
  
  // 2. src属性を持つリソース (<img>, <script>など)
  html = html.replace(/src="(https?:\/\/[^"]+)"/g, `src="${proxyBase}?u=$1"`);
  
  // 3. <link>タグ内のhref属性 (正規表現の重複を避けるため個別に処理)
  html = html.replace(/<link[^>]+href="(https?:\/\/[^"]+)"/g, (m, p1) =>
    m.replace(p1, `${proxyBase}?u=${p1}`)
  );
  
  // 4. <script>タグ内のsrc属性 (正規表現の重複を避けるため個別に処理)
  html = html.replace(/<script[^>]+src="(https?:\/\/[^"]+)"/g, (m, p1) =>
    m.replace(p1, `${proxyBase}?u=${p1}`)
  );
  
  return html;
}

// サーバーを起動し、リクエストハンドラを設定
// ★ Deno Deployに対応するため、ポートとホスト名を設定しています ★
serve({ port, hostname: "0.0.0.0" }, async (req) => {
  const urlObj = new URL(req.url);
  const target = urlObj.searchParams.get("u");
  
  // 'u' パラメータ（転送先URL）がない場合はエラー
  if (!target) return new Response("Missing url param", { status: 400 });

  try {
    const tUrl = new URL(target);

    // --- リクエストヘッダーの準備（クッキーの引き継ぎ） ---
    const headers = new Headers();
    const storedCookie = cookieStore.get(tUrl.host);
    if (storedCookie) headers.set("cookie", storedCookie); // 保存済みのクッキーを送信

    // ターゲットURLへフェッチ（実際の通信）
    const r = await fetch(target, { headers });

    // --- レスポンスヘッダーの処理（クッキーの保存） ---
    const setCookie = r.headers.get("set-cookie");
    if (setCookie) cookieStore.set(tUrl.host, setCookie); // 受け取った Set-Cookie を保存

    const contentType = r.headers.get("content-type") || "";

    // --- HTMLコンテンツの処理 ---
    if (contentType.includes("text/html")) {
      let html = await r.text();
      // プロキシのベースURLを設定 (例: https://your-app.deno.dev/)
      const proxyBase = `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`;
      
      // HTML内のリンクをプロキシ経由に書き換え
      html = rewriteLinks(html, proxyBase);
      
      return new Response(html, {
        headers: { "Content-Type": "text/html; charset=UTF-8" },
      });
    } 
    // --- その他のリソースの処理 (画像、CSS、JSなど) ---
    else {
      const body = await r.arrayBuffer();
      // コンテンツタイプを維持してそのまま返す
      return new Response(body, { headers: { "Content-Type": contentType } });
    }
  } catch (e) {
    // ネットワークエラーなどが発生した場合
    return new Response(`Proxy Error: ${String(e)}`, { status: 500 });
  }
});
