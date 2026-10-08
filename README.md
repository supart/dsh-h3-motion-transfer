# dsh-h3-motion-transfer · H3 动作迁移

把一段源视频的**动作、切点与运镜**迁移到你提供的角色参考图上，并产出可直接投喂 MiniMax H3 Ref2VA 的**六段式提示词**。本仓库是一个 **DeepSeek Harness（DSH）插件包**：装上即得技能 `h3-compact-motion-transfer`，附抽帧与切点核验工具。

**English**: An installable DeepSeek Harness bundle that publishes the `h3-compact-motion-transfer` skill, which turns a source video plus character reference images into a six-section MiniMax H3 Ref2VA motion-transfer prompt, and ships the frame-extraction and cut-verification tools the workflow needs.

---

## 一句话安装

```bash
# 从 GitHub 装最新版（把 desktop 换成你自己的 profile 名）
dsh plugin --profile desktop add github:<owner>/dsh-h3-motion-transfer

# 装完重启 DSH，技能就会出现
```

装好后：

- 插件进入该 profile 的 `~/.dsh/profiles/<name>/node_modules/`；
- 该 profile 的 `package.json` 会自动多出 `dependencies` 与 `dsh.profile.bundles` 两项（插件声明了 `dsh.bundle.patch`，无需手工编辑任何配置）；
- 重启 DSH 后，技能列表中出现 **H3 动作迁移**（技能名 `h3-compact-motion-transfer`）。

不确定 profile 名？看 `~/.dsh/profiles/` 下的目录名（桌面版通常是 `desktop`）。

从本地源码开发（改完即时生效，无需重装）：

```bash
dsh plugin --profile desktop add /absolute/path/to/dsh-h3-motion-transfer
```

卸载：

```bash
dsh plugin --profile desktop remove dsh-h3-motion-transfer
```

## 依赖与自检

工具链只需要 `ffmpeg` 与 `ffprobe`，**插件会按下面顺序自动找**，不需要你手工配置：

1. 命令行 `--ffmpeg` / `--ffprobe`
2. 环境变量 `DSH_FFMPEG` / `DSH_FFPROBE`（也认 `FFMPEG_PATH` / `FFPROBE_PATH`）
3. `assets/tools/ffmpeg-path.json`
4. `assets/tools/vendor/bin/<平台>-<架构>/`（由下面的预取脚本填充）
5. npm 包 `@ffmpeg-installer/ffmpeg`、`ffmpeg-static`（ffprobe 同理）
6. 系统 `PATH` 与常见安装路径

一条命令体检：

```bash
node assets/tools/check.mjs
# 或安装后：npx dsh-h3-motion-check
```

它会打印插件版本、`drawtext` 用的字体、两个二进制解析到的**实际路径与来源**，并检查该 ffmpeg 构建是否带 `drawtext / tile / fps / scale / select` 滤镜。

**机器上没有 ffmpeg**（大多数人的情况）：

```bash
node assets/tools/prefetch-ffmpeg.mjs
```

脚本按「镜像 → gyan.dev（Windows）→ BtbN 每日构建（全平台）→ npm 包」的顺序尝试，把二进制放进 `assets/tools/vendor/bin/<平台>-<架构>/` 并写一份 `ffmpeg-path.json`，之后工具完全离线可用。它**不会因为失败而中断安装**（只有 `--strict` 才返回非 0）。受限网络下：

```bash
# 走本地代理（脚本会读 HTTPS_PROXY）
$env:HTTPS_PROXY = "http://127.0.0.1:7897"   # Windows PowerShell
export HTTPS_PROXY=http://127.0.0.1:7897     # macOS / Linux

# 或者指到自己的镜像目录（目录名须为 <平台>-<架构>.zip，内含 ffmpeg 与 ffprobe）
node assets/tools/prefetch-ffmpeg.mjs --mirror https://your-mirror.example.com/dsh-ffmpeg
```

也可以完全不管预取，直接装一份完整版 ffmpeg，或把 `ffmpeg(.exe)`/`ffprobe(.exe)` 手工放进 `assets/tools/vendor/bin/<平台>-<架构>/`。

## 技能怎么用

技能名 `h3-compact-motion-transfer`，被调用时需要三样输入：

1. **源视频**（必填）：提供绝对路径；技能会先抽帧、把整片从头到尾看完。
2. **角色参考图**（必填）：一张或多张，按 `Picture 1`、`Picture 2` … 的**声明顺序**编号。
3. **映射**（必填，只能由人指定）：哪张图替换源片里的哪个人。技能不会替你猜——猜错的代价是整段成片里两个人对调。

流程（每一步都留证据）：

```bash
# 1) 抽帧（约 5–10 秒的片段用 8fps；长片降 fps 到抽样总数 40–80 帧）
node assets/tools/frames.mjs --video <源片绝对路径> --out .h3work/seg01 \
     --fps 8 --scale 448 --cols 4 --rows 3 --motion 16

# 2) 找候选切点（场景分数，阈值 0.12；无候选即单镜头）
ffmpeg -hide_banner -nostats -i <源片> \
  -vf "select='gt(scene\,0.12)',metadata=print:file=-" -an -f null -

# 3) 用已确认的镜头表出过程拼图 + 每个切点的原生帧率边界图
node assets/tools/verify-sheets.mjs --video <源片> --out .h3work/seg01/verify \
     --shot 0-1.750:SHOT1 --shot 1.750-2.750:SHOT2 --shot 2.750-5.501:SHOT3 \
     --fps 24 --boundary 0.35 --scale 640

# 4) 把过程拼图发给操作者核对切点与映射，然后写六段式提示词
```

产出长这样（六段契约，节选）：

```text
subject_definitions:
<Subject 1> replaces the single presenter in <Video 1>. Her appearance comes only from <Picture 1>, …
<Subject 2> is the retained setting from <Video 1>: …
summary:
[video editing + reference generation] The target video is an edited version of <Video 1>. …
retention_analysis: …
detailed_description: …
overall_soundscape: N/A.
non_diegetic_music: N/A.
```

完整方法论文档在 [`assets/SKILL.md`](assets/SKILL.md)（硬规则、身份锚点、道具归属、水印处理、排错都在里面），两个格式范例在 `assets/references/`。

## 排错

| 现象 | 原因与处理 |
|---|---|
| 插件装了但**技能不出现** | 没重启 DSH；或 profile 名不对。重启后仍无，跑 `dsh plugin --profile <name> list` 确认依赖装上了 |
| 每条命令都 `exit code 3221225794`（`0xC0000142`） | Windows 进程创建失败，属于宿主故障，不是插件问题。**退出 DSH 全部进程重开**即可恢复 |
| 提示找不到 `ffmpeg` / `ffprobe` | 跑 `node assets/tools/check.mjs` 看解析链，然后 `node assets/tools/prefetch-ffmpeg.mjs`，或设 `DSH_FFMPEG` |
| 表上没有时间戳/切点标签 | 该 ffmpeg 构建缺 `drawtext`（精简版常见）。装完整版或用 `DSH_FFMPEG` 指过去；`--doctor` 会提前报警 |
| 某个 `--out` 目录里是**另一个视频**的帧 | 目录占用保护被 `--force` 绕过，或批量脚本把同名文件写进了同一目录。给每支源片各自一个 `--out` |
| 抽帧数与预期差 1 帧 | 正常：末帧可能落在片长之外。工具会打印 `lastSampledTimestamp` 与 `coverageComplete` 供核对 |
| 代理环境下 github.com 超时 | 设 `HTTPS_PROXY`，或给 `prefetch` 传 `--mirror` |

## 已验证环境

`1.2.0` 在 Windows 11 + Node 24 + pnpm 11 上实测通过：

| 项目 | 结果 |
|---|---|
| `dsh plugin --profile <name> add <本地路径>` | ✅ exit 0，`dependencies` 与 `dsh.profile.bundles` 自动补上 |
| `dsh plugin --profile <name> remove …` | ✅ exit 0，两项自动移除 |
| `node assets/tools/check.mjs` | ✅ 报出版本 1.2.0、解析到的二进制来源与滤镜清单 |
| `node assets/tools/frames.mjs`（抽帧 + 接触表） | ✅ 单元格时间戳与表头正常渲染 |
| `node assets/tools/verify-sheets.mjs`（3 镜头 / 单镜头） | ✅ 切点红框与 `CUT -> SHOTn` 标签正常；单镜头报 `boundary_sheets: 0` |
| `node assets/tools/prefetch-ffmpeg.mjs --dry-run` | ✅ 按平台给出下载计划 |

**尚未实测**（需要可达网络，请在你的环境里各跑一次）：`prefetch-ffmpeg.mjs` 的真实下载，以及 `add github:<owner>/<repo>` 的 git 安装路径。若 git 安装报错，先确认 `pnpm` 在 PATH 上（DSH 桌面版自带的运行时可能只提供 `pnpm.mjs`，可在 `~/.dsh/profiles/_shim/pnpm.cmd` 放一个包装脚本指向它）。

## 许可证

MIT，见 [LICENSE](LICENSE)。方法论上游是 MiniMax H3 Ref2VA 提示词工作流与两份格式范例（`assets/references/`）；仓库不包含任何源视频素材。
