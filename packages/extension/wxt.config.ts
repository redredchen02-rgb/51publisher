import { defineConfig } from "wxt";

const DEFAULT_HOSTS = ["https://dx-999-adm.ympxbys.xyz/*"];

// 本地后端地址:声明为 host_permission,使扩展(SW/sidepanel)调用 loopback
// 不被 Chrome 的 Local Network Access(私有网络访问)拦截。仅授予权限,
// 不作为 content_script 注入目标(matches 由 content 入口自动生成,与此无关)。
const BACKEND_HOSTS = ["http://127.0.0.1:3001/*", "http://localhost:3001/*"];

function parseHosts(): string[] {
	const raw = process.env.ALLOWED_HOSTS ?? "";
	const siteHosts = raw.trim()
		? raw
				.split(",")
				.map((h) => h.trim())
				.filter(Boolean)
		: DEFAULT_HOSTS;
	return [...siteHosts, ...BACKEND_HOSTS];
}

// 固定扩展公钥 → 派生稳定扩展 ID(iljimdgfajpgnmanklehhmapojbcjecd)。
// 公钥非机密,可入库;对应私钥(.pem)留在仓库外。钉死 ID 后无论重载/重装,
// ID 不变,后端 CORS_ORIGIN 配一次永久有效(终结 ID 漂移→CORS 反复失效的循环)。
// 可用 EXTENSION_KEY 环境变量覆盖(留空则用下方默认)。
const EXTENSION_KEY =
	process.env.EXTENSION_KEY ??
	"MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAsDYZkMsPLZEkorkMHR1rozGm+8a+eSv3oU510zzTVUu9UvzahuVC64lFe28gAmpL7ecagJz3k+efJ1kwPrJ/hnf50Wyy+Cgx57BNFQl4GMUDcH7rkeFxynSIy5g8JlINDTWEusJYxIrMQnQ7mP5kY1xjLemiPfrFGq8OJztT8MBofLA+2PWesS/gjtWV1iOWeMpRRIZ5RBq/Recg16Ia4yQppSc49dji0C8ymVmQnEJeUA/NcW4t04nIVKFQTepgscODk7FygjOUcE8IELmYN/FbGLBwpNjDtvEItmYnR9PsIeFZ2sGBizQ+kTCuNdcXYQ9wOnegdKvBej4cYGLuAwIDAQAB";

export default defineConfig({
	modules: ["@wxt-dev/module-react"],
	manifest: {
		name: "51publisher 发帖填充助手",
		description:
			"AI 生成草稿并填入后台发帖表单。授权站点可批量自动发布,非授权站点仅填充。",
		key: EXTENSION_KEY,
		// alarms:background 用 chrome.alarms 做 SW keep-alive;缺此权限会让
		// chrome.alarms 为 undefined,background main() 启动即抛异常 → SW 整个失效。
		permissions: ["storage", "sidePanel", "alarms"],
		host_permissions: parseHosts(),
		action: { default_title: "51publisher 填充助手" },
		side_panel: { default_path: "sidepanel.html" },
	},
});
