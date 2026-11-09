# 实现

面向改代码的人。用户只需要 README。

## 结构

| 文件 | 作用 |
|---|---|
| `index.js` | Host：`GET/PUT /sidebar-manager/config`，文件落 `$DSH_HOME/storages/sidebar-manager/config.json`，写入仅接受 loopback 对端；负责规范化和修复配置 |
| `client.js` | 浏览器：More 菜单一行 + 常驻挂载点 + 管理对话框 + 侧栏标题绘制 |
| `cordis.patch.yml` | 向 profile 插入一行 host 插件 |

客户端是手写 bundle（`window.__ModuleLoader__.load` 注册 factory），不需要构建步骤；服务端只依赖 `webServer` 服务，没有工具、没有会话事件、不参与模型请求。

## 配置格式（v2）

```json
{
  "version": 2,
  "hidden": ["github-radar"],
  "groups": [{ "id": "g-daily", "name": "Daily" }],
  "sections": ["g-daily", "__ungrouped__"],
  "collapsed": [],
  "placement": { "ai-daily": "g-daily" },
  "order": ["ai-daily", "stock-shadow", "schedules"]
}
```

- `sections` 决定分组块的先后，`__ungrouped__` 是隐含的「未分组」块，永远存在；
- `collapsed` 是收起的文件夹 id；收起只是把成员行藏起来，不改变显隐勾选；
- `order` 是块内的先后；块内按 `order` 里的下标排，未出现的面板按插件声明顺序排在后面；
- v1（只有 `hidden`）会被自动规范化升级。

## 启动时怎么生效

侧栏的 pin 集合不是服务，只通过 `sidebar.panellist.actions` 的 `onPinnedChange` 属性发给菜单里的注册项——而对话框必须在 More 从未打开时就把行藏好。所以启动路径是：读 sidebar 自己的 slot 注册，调用它的 `inject()` 拿到同一个 `setPinned`。

侧栏的注册可能晚于本插件，所以：`apply` 里立即尝试一次 → 按帧重试（最多 30 帧）→ `sidebar` / `sidebar.panellist` 的 slot 变化各触发一次重试。

排序则反过来：把算好的 `order` 写回各插件注册时的 options 对象，再注册并立刻 dispose 一个临时行，让 slot 注册表发一次变更、sidebar 重新排序；两次操作在同一个任务里，React 不会画出那一行。

## 顺序的稳定基线

插件注册时声明的 `order` 会被本插件覆盖，所以「插件原本想放哪」必须记住：每个面板第一次出现时把它的声明值存进 `baseline`，保存的 `order` 里没有的面板按这个基线排在块尾。否则每次重算都会把当前顺序当输入，顺序会自己漂移。

## 已验证

- 隐藏/显示、全部显示、重载后保持；
- 建分组、改名（聚焦即全选）、把面板移进/移出分组、行上下移跨越分组边界；
- 分组整块上下移动、删除分组（成员回到未分组）；
- 点文件夹行展开/收起（真实鼠标点击验证），成员行随之出现/消失，状态写进 `collapsed`；
- 改分组名后侧栏那一行的文字立即跟着变（靠一次额外的 registry sync）；
- 关对话框时若有未落盘的改动会立即 flush，不等 250ms 防抖。
