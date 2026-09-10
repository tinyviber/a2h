# A2H — Design

A2H 的 Human-facing UI 长期设计约束。实现 UI 与之后修改 UI 前，先读这份文件。

## 目标

A2H 把 Agent 留下的混乱 workspace 编译成一个适合人阅读、理解、检查的本地 Web 界面。

界面本身应当退后，让 repository 里的 artifacts 成为视觉中心。人在这里做的事只有四件：

- **reading** — 读 README、报告、笔记
- **inspection** — 看 diff、代码、JSON、日志
- **comparison** — 比较多个产出，判断哪个是最终版
- **judgment** — 快速确认 Agent 到底做了什么、值不值得信

装饰不服务于这四件事。

## Visual principle

> A warm, quiet, reading-first local work surface.

暖色、安静、以阅读为先。不是 dashboard，不是 admin console，不是 "AI 生成结果" 的紫色渐变展示页。

## Base colors

```css
--paper: #efeae0;      /* 页面底色 */
--card: #fdfcf8;       /* 卡片表面 */
--card-border: #e6dfcf;/* 卡片描边 */
--text: #1a1916;       /* 主文字 */
--muted: #6b6660;      /* 次要/元数据文字 */
--strong: #1a1916;     /* 强调文字 */
--track: #ded7c7;      /* 分割线 / 轨道 */
```

语义状态色（只作辅助，不承担全部语义）：

```css
--success: #2a6b45;
--running: #2c4a6e;
--failed: #9b2c2c;
--partial: #8a5a12;
```

颜色永远是第二信号。去掉颜色，界面仍应可理解：什么重要、什么是 metadata、什么可展开。

## Cards

Card 是安静的结构容器：

```css
--radius: 14px;
--card-shadow:
  0 1px 2px rgba(26, 25, 22, 0.04),
  0 6px 20px rgba(26, 25, 22, 0.06);
```

规则：

- 不要 nested cards。
- 不要为了装饰制造大量容器。
- 一个卡片 = 一个明确的阅读/检查单元。

## Typography

优先 system fonts，不引入 webfont。

Sans：

```css
font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
```

Mono：

```css
font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
```

长篇阅读宽度保持克制。约 `40rem` 作为默认 reading measure。

## Spacing

少量明确步长：

```
4 / 8 / 12 / 16 / 24 / 40
```

不要出现任意数值的 padding/margin。

## Responsive

mobile-first。必须真实验证：

- `390px`（移动端）
- desktop

390px 下不允许出现 page-level 意外的横向溢出。Code / diff / log 自己内部横向滚动是允许的。

## Visual restraint

禁止：

- decorative gradients
- glow
- glassmorphism
- neumorphism
- purple-blue AI default visual style
- nested cards
- badge / pill 堆叠
- 不必要的图表
- generic hero section
- 大量装饰性 icon container
- 深色圆角 box 套住所有 code
- 过度 motion

Motion 只用于服务理解状态（例如展开/折叠、内容更新提示）。尊重：

```css
@media (prefers-reduced-motion: reduce) { ... }
```

## Information hierarchy

信息层级必须由 repository 的真实内容决定，而不是由文件扩展名决定。

第一屏要回答：

1. 这个 repository 是什么？
2. 最近有哪些值得看的产出？
3. 我应该先看什么？
4. 有哪些 report / diff / image / log / artifact？
5. 哪些内容属于同一组？

优先级信号（从强到弱）：内容语义 > 目录/文件名约定 > 时间 > 扩展名。

## Reading surface

- Markdown：良好的 GFM 阅读体验，不执行 arbitrary HTML/JS。
- Code：清晰 monospace，长内容可滚动/折叠。
- Diff：适合人 review，长 diff 先 preview 再展开。
- Log：超长 log 不默认铺开，优先展示 tail 或重要区域，可展开完整。
- JSON：默认结构化展示，同时保留 raw view。
- Image：自然预览，保留路径与 metadata。
- 未知文件：不能导致页面失败，至少作为普通 artifact 暴露。
