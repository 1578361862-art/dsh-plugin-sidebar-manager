# @local/dsh-sidebar-manager

左侧栏入口管理器。给 DSH Web GUI 的左侧导航加一行 **More → Manage sidebar entries…**：列出所有注册到 `sidebar.panellist` 的插件面板，可以显示/隐藏、上下移动、建分组并把面板放进分组。选择保存在 profile 里，重载页面后照旧生效。文案跟随界面语言（中文 / English）。

## 它解决什么

DSH 的每个插件面板都会在左侧栏永久占一行，而内核没有提供入口管理：面板全显示、顺序由插件声明、More 菜单里只有「浏览插件 / 创建插件」。插件的 `setPinned` 机制存在，但只改内存、刷新即复原，也没有任何 UI 调用它。

这个插件补上那一层：

- **显隐**：把不常用的面板行收起来，面板本身、插件、工具都不卸载；
- **排序**：上下移，或直接从下拉里换分组；
- **分组**：自建命名分组、改名、上下移动整块、删除；侧栏里每个分组就是一行文件夹，点一下展开/收起，成员缩进排在下面；
- **持久化**：写 `$DSH_HOME/storages/sidebar-manager/config.json`，每次启动回放。

## 边界

- 只影响**行**。隐藏某个面板后，它的主面板、当前选中状态、后台运行都不变；如需真正卸载插件，用 Plugins 页的开关。
- `Plugins` 行由内核写死：永远显示、永远是第一行，不进管理器。
- 分组行是**本插件注册的合成面板**（id `sm-group:<gid>`），不是内核的分组：它占一行、有 chevron，行上盖了一层透明点击层，点整行 = 展开/收起（内核那套「点行 = 选中面板」被挡住）。成员行按「打开的分组」缩进，收起的组把成员从 pin 列表里藏掉，但插件和面板都还在。
- 排序是改写注册项上的 `order` 值（内核没有改序接口）。这属于页面内状态：插件重载会恢复它声明的顺序，所以每次启动都要回放（见下）。

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

## 安装

```sh
dsh plugin --profile desktop add link:/Users/yee/Work/dsh/default-workspace/sidebar-manager-plugin
```

Host 半边改动后需要重载插件才会生效（Plugins 页关一次再开，或重启应用）；客户端半边改完刷新页面即可。

## 已验证

- 隐藏/显示、全部显示、重载后保持；
- 建分组、改名（聚焦即全选）、把面板移进/移出分组、行上下移跨越分组边界；
- 分组整块上下移动、删除分组（成员回到未分组）；
- 点文件夹行展开/收起（真实鼠标点击验证），成员行随之出现/消失，状态写进 `collapsed`；
- 改分组名后侧栏那一行的文字立即跟着变（靠一次额外的 registry sync）；
- 关对话框时若有未落盘的改动会立即 flush，不等 250ms 防抖。
