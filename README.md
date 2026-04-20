# Sprite Video Lab

一个本地运行的小工具，用来把视频片段或单张图片整理成适合 2D sprite 流程的透明 PNG 帧。

它适合这种工作流：

- 导入本地视频或图片
- 截取需要的时间区间
- 按固定步长抽帧
- 对绿幕或纯色背景做抠图
- 统一缩放和落地位置
- 导出透明帧、雪碧图和 zip 包

当前项目是 Windows 优先开发的，但核心服务端本身也尽量保持了跨平台可运行。

## 功能

- 支持直接输入本地路径，或拖拽上传视频/图片
- 支持视频区间预览和区间确认
- 支持单帧预览，先调参数再整段处理
- 支持自动取色或手动指定背景色
- 支持阈值、软边、去色溢出、halo 收缩等抠图参数
- 支持批量选择帧并导出 sprite sheet
- 处理结果默认写入本地 `work/` 目录

## 技术栈

- Python 3.10+
- Pillow
- ffmpeg / ffprobe
- 原生 HTML / CSS / JavaScript

## 快速开始

### 1. 克隆仓库

```bash
git clone https://github.com/<your-name>/sprite-video-lab.git
cd sprite-video-lab
```

### 2. 安装依赖

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

### 3. 安装 ffmpeg

推荐把 `ffmpeg` 和 `ffprobe` 放进系统 `PATH`。

如果你已经有一份独立 ffmpeg 目录，也可以通过环境变量指定：

```powershell
$env:SPRITE_VIDEO_LAB_FFMPEG_DIR="D:\ffmpeg\bin"
```

### 4. 启动

Windows 下可以直接双击：

```bat
start_sprite_video_lab.bat
```

或者命令行启动：

```bash
python server.py
```

启动后默认访问：

```text
http://127.0.0.1:8894
```

## 可选环境变量

- `SPRITE_VIDEO_LAB_HOST`
  - 默认 `127.0.0.1`
- `SPRITE_VIDEO_LAB_PORT`
  - 默认 `8894`
- `SPRITE_VIDEO_LAB_FFMPEG_DIR`
  - 可选，指向包含 `ffmpeg(.exe)` 和 `ffprobe(.exe)` 的目录
- `SPRITE_VIDEO_LAB_FFMPEG_ACCEL`
  - 可选，支持 `auto`、`cpu`、`cuda`、`qsv`、`d3d11va`、`dxva2`

也可以通过命令行参数覆盖 host / port：

```bash
python server.py --host 127.0.0.1 --port 8894
```

## 目录说明

```text
app/       前端页面与交互逻辑
server.py  本地 HTTP 服务与处理逻辑
work/      运行期产物目录（已加入 .gitignore）
```

## 开源说明

- 仓库默认忽略 `work/`、缓存文件和虚拟环境
- 建议不要把自己的测试视频、导出 PNG、zip 包直接提交到 Git
- 许可证当前使用 MIT；如果你想改成 Apache-2.0 或 GPL，也可以再调整

## 后续可继续补的内容

- README 截图或动图演示
- 示例输入素材和示例导出结果
- issue / PR 模板
- 自动化测试

## License

[MIT](./LICENSE)
