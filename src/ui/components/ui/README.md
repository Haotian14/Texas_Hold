# shadcn/ui 组件

这个目录里的文件是 **shadcn/ui 风格的组件源码**：底层是 Radix 的无样式原语
（`radix-ui` 包），外面一层用 Tailwind 工具类上色，色值全部取自
`src/ui/styles/app.css` 里那套设计令牌。

**为什么是手写而不是 `npx shadcn add`。** shadcn 的分发方式是把源码复制进你的
仓库（而不是发一个 npm 包），复制的来源是 `ui.shadcn.com` 上的注册表。本项目
的开发环境访问不到那个域名，所以这几个文件是照它的形状手写的：一样的
`data-slot` 约定、一样的 `cn()` 合并入口、一样的 cva 变体结构。**日后网络通了
可以直接用 CLI 覆盖它们**，`components.json` 已经配好，别名指向本目录。

**改样式改这里，不要去 app.css 加规则。** app.css 里那两千行是无层 CSS，优先级
高于 Tailwind 的任何工具类——在那边给这些组件加规则，等于给自己埋一个"类名写了
不生效"的坑，而且下次 CLI 覆盖时不会被带走。
