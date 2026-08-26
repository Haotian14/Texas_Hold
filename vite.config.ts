import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// base 用相对路径，使构建产物可以放在静态托管的任意子路径下
// （③-D 上线时不必回头改这里）。
export default defineConfig({
  base: './',
  // '@/x' → 'src/x'。shadcn 生成的组件之间用这个前缀互相引用，是它的约定，
  // 不是本项目的偏好——现有代码继续用相对路径，不必回头改。
  // vitest.config.ts 里有一份同样的声明：两份配置各自独立，测试跑的时候
  // 不经过 vite.config.ts。
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // 'prompt' 而不是 'autoUpdate'：autoUpdate 发现新版本会直接
      // location.reload()，而**对局状态刷新即丢**（只有结算后的 HandRecord
      // 进了 IndexedDB，进行中的那手在 React state 里）。一次后台更新把用户
      // 打到一半的牌吞掉，比晚一次启动才用上新版本糟得多。
      //
      // 配合下面的 skipWaiting: false：新版本静静装好，等应用被完全关闭后
      // 的下一次启动生效，中途不打断任何一手牌。代价是常驻不关的用户会在
      // 旧版本上多待一阵——要缩短这个窗口得给「有新版本，现在刷新？」做个
      // 界面，那是设置页那批活儿的事。
      registerType: 'prompt',
      // public/ 里不属于 manifest icons 的那些静态文件走这里。
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: '德州扑克模拟训练器',
        short_name: '扑克训练',
        description: '6-max 现金局模拟与逐手复盘：告诉你哪一步打错了、错在哪、亏了多少。',
        lang: 'zh-CN',
        // start_url 与 scope 用相对值，跟 base: './' 是同一个理由：
        // 写死 '/' 会把应用钉死在域名根上。
        start_url: '.',
        scope: '.',
        display: 'standalone',
        orientation: 'portrait',
        // 与 index.html 的 theme-color 同色，两处不一致时地址栏会闪一下
        background_color: '#f7f8fa',
        theme_color: '#f7f8fa',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          // maskable 单独一张：Android 会把图标裁成系统形状，
          // 圆角方块那版被裁掉边角会露出底噪，这张是满幅底色 + 缩进的标记。
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // 只圈构建产物与音效。manifest 本身与它列出的三张图标由插件自己
        // 预缓存，png/svg/webmanifest 再写进来会让同一个文件在 precache
        // 清单里出现两遍（清单变长、构建日志的条目数对不上实际文件数）。
        // 音效一并预缓存：四个文件合计 68KB，换来的是断网时牌桌不是哑的。
        globPatterns: ['**/*.{js,css,html,mp3}'],
        skipWaiting: false,
        clientsClaim: false,
      },
    }),
  ],
  build: {
    outDir: 'dist',
  },
});
