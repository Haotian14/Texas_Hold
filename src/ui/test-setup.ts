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

/**
 * jsdom 的缺口补丁。
 *
 * Radix 的浮层组件（Select、AlertDialog）依赖几个 jsdom 至今没有实现的
 * 浏览器 API。它们在真浏览器里全部存在，所以这里补的是**测试环境的缺口，
 * 不是应用的兼容层**——应用代码里一行都不该出现这些判断。
 *
 * 只在有 document 时执行：同一个引导文件也被 800 多个 node 环境的用例加载，
 * 那边没有 Element 可以打补丁，也不需要。
 */
if (typeof document !== 'undefined') {
  // 指针捕获：Radix 用它判断拖拽是否仍在控件上。jsdom 的 Element 上没有
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.setPointerCapture = () => undefined;
    Element.prototype.releasePointerCapture = () => undefined;
  }
  // 下拉打开时把选中项滚进视野。jsdom 不做布局，这里是空实现
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => undefined;
  }
  // 浮层测量触发器尺寸用。jsdom 没有 ResizeObserver
  if (!('ResizeObserver' in globalThis)) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
}
