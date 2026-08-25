/**
 * 测试引导：注册 jest-dom 的断言（`toBeChecked` / `toHaveValue` / `toBeDisabled`
 * 之类）。
 *
 * 它对**所有** 58 个测试文件生效，包括跑在 node 环境的那 800 多个逻辑用例。
 * 这样做是有意的：jest-dom 的 vitest 入口只做一件事——`expect.extend`，不碰
 * DOM（匹配器要到真正断言时才读 `document`），在 node 环境下引入是安全的，
 * 代价是每个 worker 多一次几毫秒的 import。
 *
 * 反过来，**环境不在这里配**。UI 测试用文件头的 `@vitest-environment jsdom`
 * 逐个声明，而不是把全局 environment 改成 jsdom：现有那批自对弈/蒙特卡洛用例
 * 一个要跑几十秒，让它们平白套一层 jsdom 只会更慢，而且它们一行 DOM 都不碰。
 */
import '@testing-library/jest-dom/vitest';
