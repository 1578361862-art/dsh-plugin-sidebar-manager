# 侧栏分组 · dsh-plugin-sidebar-manager

> 给 DSH 左侧栏加上隐藏、排序和分组：把几十行插件入口收成几行文件夹。

![DSH](https://img.shields.io/badge/DSH-%E2%89%A5%200.2.1--rc.5-4f46e5?style=flat-square)
![Node](https://img.shields.io/badge/node-%E2%89%A5%2020-339933?style=flat-square&logo=nodedotjs&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-2ea44f?style=flat-square)

DSH 的每个插件面板都会在左侧栏占一行，顺序由插件自己声明，内核没有提供入口管理：More 菜单里只有「浏览插件 / 创建插件」。装到十几个插件之后，这一列就没法扫了。

这个插件补上那一层。左侧栏 **More → Manage sidebar entries…** 打开管理对话框：

- **显隐** —— 勾掉不常用面板的行；面板本身、插件、正在跑的任务都不受影响；
- **排序** —— 上下移动，行序写回 sidebar 的注册项；
- **分组** —— 建命名分组、改名、整块上下移动、删除；侧栏里每个分组就是一行文件夹，点一下展开/收起，成员缩进排在下面；
- **持久化** —— 选择写进 profile，重载页面后照旧生效。

界面文案跟随 DSH 的界面语言（中文 / English）。

## 安装

```sh
dsh plugin --profile <profile> add https://github.com/1578361862-art/dsh-plugin-sidebar-manager/releases/latest/download/dsh-plugin-sidebar-manager.tgz
```

`<profile>` 换成你实际的 profile 名：DSH Desktop 是 `desktop`，`dsh web` 一般是 `web`。装完重启 DSH。

也可以从仓库源码装（需要 pnpm 允许构建，本插件没有构建步骤）：

```sh
dsh plugin --profile <profile> add github:1578361862-art/dsh-plugin-sidebar-manager
```

## 用法

1. 左侧栏底部 **More** → **Manage sidebar entries…**
2. 每一行是一个已注册的面板：开关控制显隐，右侧 ↑ ↓ 调顺序，下拉框放进分组
3. 底部「新建分组」，分组按你排的顺序成为侧栏里的文件夹行
4. 点侧栏里的文件夹行 = 展开/收起；点「全部显示」把所有行放回来

排序立即生效，不需要重启；改动在关闭对话框时落盘（有 250ms 防抖，关窗会强制 flush）。

## 边界

- **只影响行**。隐藏一个面板不卸载插件，也不影响它的主面板、当前选中状态和后台任务；真要卸载，用 Plugins 页的开关。
- **`Plugins` 行由内核写死**：永远显示、永远是第一行，不进管理器。
- **分组行是本插件注册的合成面板**（`sm-group:<gid>`），不是内核的分组机制：它占一行、有 chevron，行上盖了一层透明点击层，所以点整行是展开/收起，而不是选中某个面板。
- **排序是页面内状态**：排序靠改写注册项上的 `order` 值实现（内核没有改序接口），插件重载会恢复它自己声明的顺序，所以每次启动都重放一遍配置。
- 只支持 Web 端（`platform: web`），不涉及终端界面。

## 配置在哪

```text
$DSH_HOME/storages/sidebar-manager/config.json
```

内容是一个带 `version` 的 JSON：`hidden`（隐藏的行）、`groups`（分组定义）、`sections`（分组块顺序）、`collapsed`（收起的文件夹）、`placement`（行 → 分组）、`order`（块内顺序）。写在 loopback 的 `PUT /sidebar-manager/config`，只接受本机对端。

## 卸载

```sh
dsh plugin --profile <profile> remove dsh-plugin-sidebar-manager
```

侧栏回到「所有行都显示、按插件声明的顺序」。配置留在 `storages/sidebar-manager/config.json`，想彻底清掉就删这个目录。

## 实现

Host 半边只有一条读写配置的路由，客户端半边是手写 bundle（无构建步骤）：显隐用 sidebar 的 `setPinned`，排序靠「改写 options.order → 注册 → 立刻 dispose 一个临时行」逼 registry 重排，分组行是合成面板加一层透明 hit 层。细节、启动时序和已验证项见 [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md)。

## 许可

[MIT](LICENSE) © Yee
