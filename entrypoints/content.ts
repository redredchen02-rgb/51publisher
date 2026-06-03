// 隔离世界 content script:接收填充指令、操作普通字段、转发正文给主世界。
// U1:占位,只声明匹配范围;填充逻辑在 U4/U5 加。
export default defineContentScript({
  matches: ['*://*.ympxbys.xyz/*'],
  main() {
    // U4/U5 在此注册 runtime 消息监听与字段填充。
  },
});
