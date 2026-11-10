# 展开过程灰白横带修复

用户录像显示，窗口变高过程中，底部新露出的区域会短暂显示灰白横带。此前的 offscreen paint 检查仅覆盖 Chromium 页面，未检测到系统合成画面的横带。

修复让 Windows 原生窗口自创建起采用透明绘制底层（transparent=true、backgroundColor=#00000000），页面继续使用深色背景和原有 260ms 高度动画。尚未绘制的新增像素透出桌面，不使用白色底层。对应选项集中在 getWindowOptions，正式启动与界面检查共用。接口依据见 [Electron 窗口选项](https://github.com/electron/electron/blob/main/docs/api/structures/base-window-options.md)。

透明窗口仍从创建时保持 resizable=true，通过最小/最大高度限制简洁模式。没有在运行时切换该样式。真实桌面上已手动验证拖动边缘缩小宽度。

150% 缩放下，透明绘制层存在坐标及宽度舍入：请求宽高和实际内容宽高可能差 1 DIP。窗口管理器记录并复用校准请求，避免每帧重复反馈；屏幕边缘调整位置时保留原有物理像素相位。

| 本机实际桌面录屏 | 检查帧数 | 灰白横带帧数 | 遮挡帧数 |
| --- | ---: | ---: | ---: |
| 旧的不透明绘制底层 | 719 | 18 | 0 |
| 修复后的透明绘制底层 | 719 | 0 | 0 |

两组各执行 8 轮折展，覆盖 45%、90%、100% 不透明度。测试画面只使用隔离数据和带颜色标记的专属背景板。检测针对横跨窗口的灰白横带，能够检出短条，不再只判断整帧是否发白。此结果限于本机这组录屏。

另通过 17 项窗口逻辑、2 项日志、30 项界面检查，包括尺寸漂移、屏幕边缘、快速反向点击、排序、简洁切页和减少动态效果。

运行 npm run test:desktop:visible 复查；该测试需要 Windows 和 ffmpeg。设置 READSCOPE_FLASH_VARIANT=baseline 可复现旧底层；默认 fixed。视频与 summary.json 位于 artifacts/desktop-flash-qa。
