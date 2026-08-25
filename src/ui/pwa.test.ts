import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

/**
 * PWA 接线的一致性守卫。
 *
 * 这些断言读的是 vite.config.ts 与 index.html 的**源码文本**，不是导入后的
 * 对象——VitePWA(...) 返回的是一组已经实例化的插件钩子，配置对象在里面取
 * 不回来。与 architecture.test.ts 同一手法：正则扫源码，为的是钉住那些
 * 「改了一处忘了另一处」的地方。
 *
 * 真正的行为验证（注册 SW、断网重载、离线取音效）不在这里——那要一个真
 * 浏览器，属于手工/端到端范畴。这里只保证配置本身自洽：引用的图标文件确实
 * 存在、两处主题色没有分叉、不会在打牌途中自动重载。
 */

const viteConfig = readFileSync('vite.config.ts', 'utf-8');
const indexHtml = readFileSync('index.html', 'utf-8');

describe('PWA 接线', () => {
  it('manifest 里引用的图标在 public/ 里都存在', () => {
    const srcs = [...viteConfig.matchAll(/\{\s*src:\s*'([^']+)'/g)].map(m => m[1]);
    // 空数组会让下面的循环体一次都不执行、测试静默通过
    expect(srcs.length).toBeGreaterThanOrEqual(3);

    const missing = srcs.filter(s => !existsSync(`public/${s}`));
    expect(missing).toEqual([]);
  });

  it('Android 的 maskable 图标单独给了一张', () => {
    // 只给 purpose 缺省的图标时，Android 会把整张图裁进系统形状里，
    // 圆角方块的四角会被切掉。这条钉住那张满幅底色的备用图不被删掉。
    expect(viteConfig).toMatch(/purpose:\s*'maskable'/);
  });

  it('iOS 的主屏图标在 index.html 里，且指向真实文件', () => {
    // iOS 不读 manifest 的 icons，只认这条 link，且只认位图。
    const m = indexHtml.match(/rel="apple-touch-icon"\s+href="\/([^"]+)"/);
    expect(m).not.toBeNull();
    expect(existsSync(`public/${m![1]}`)).toBe(true);
    expect(m![1]).toMatch(/\.png$/);
  });

  it('index.html 与 manifest 的主题色一致', () => {
    // 两处不一致时，地址栏会在 manifest 生效前后闪一下颜色。
    const html = indexHtml.match(/name="theme-color"\s+content="([^"]+)"/);
    const manifest = viteConfig.match(/theme_color:\s*'([^']+)'/);
    expect(html).not.toBeNull();
    expect(manifest).not.toBeNull();
    expect(manifest![1]).toBe(html![1]);
  });

  it('不会在打牌途中自动重载', () => {
    // 进行中的那手牌只存在于 React state 里（只有结算后的 HandRecord 进
    // IndexedDB），后台更新一旦 reload 就把它吞了。registerType 必须不是
    // autoUpdate，且新 SW 不得抢占当前页面。
    expect(viteConfig).toMatch(/registerType:\s*'prompt'/);
    expect(viteConfig).not.toMatch(/registerType:\s*'autoUpdate'/);
    expect(viteConfig).toMatch(/skipWaiting:\s*false/);
    expect(viteConfig).toMatch(/clientsClaim:\s*false/);
  });

  it('start_url 与 scope 是相对值，应用不被钉死在域名根上', () => {
    // 与 base: './' 同一个理由，见 vite.config.ts 的注释。
    expect(viteConfig).toMatch(/start_url:\s*'\.'/);
    expect(viteConfig).toMatch(/scope:\s*'\.'/);
    expect(viteConfig).toMatch(/base:\s*'\.\/'/);
  });

  it('音效进了预缓存清单', () => {
    // 断网时牌桌不该是哑的。四个文件合计 68KB，代价可以忽略。
    const glob = viteConfig.match(/globPatterns:\s*\[([^\]]+)\]/);
    expect(glob).not.toBeNull();
    expect(glob![1]).toContain('mp3');
  });
});
