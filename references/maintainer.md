# 管理员维护指南（仅金阳本人，客服无需看）

## 发布到 GitHub（一次性）

需要 GitHub 账号。两种方式任选：

### 方式 A：命令行（需先装 gh 或用 token）
```bash
cd ~/.workbuddy/skills/waimao-scraper
# 建私有仓库（推荐私有，避免采集逻辑公开）
git remote add origin git@github.com:<你的用户名>/waimao-scraper.git
git branch -M main
git push -u origin main
```
> 在 GitHub 网页先建一个**私有**空仓库 `waimao-scraper`，不要初始化 README。

### 方式 B：网页
1. github.com → New repository → 命名 `waimao-scraper` → **Private** → 不勾选任何初始化 → Create
2. 本地关联并推送（同上命令）

## 客服机器上首次安装

在客服的 WorkBuddy 里说一句即可，agent 会自动：
```bash
git clone git@github.com:<你的用户名>/waimao-scraper.git ~/.workbuddy/skills/waimao-scraper
cd ~/.workbuddy/skills/waimao-scraper && npm install
```
（私有仓库需客服机器能访问 GitHub——可配 deploy key 或改用内部 Git 服务）

## 日常更新版本（你维护时）

```bash
cd ~/.workbuddy/skills/waimao-scraper
# 改代码 …
git add -A && git commit -m "fix: xxx"
git push
```
客服侧下次调用时 `node src/update.js` 会自动检测并拉取，**客服无感知**。

## 更新机制说明

- `src/update.js`：`git fetch` → 对比本地/远程 HEAD → 有差异则 `git pull --ff-only` → `npm install`
- 失败（本地冲突）时自动 stash 再拉；仍失败则提示人工处理
- 全程在采集前静默执行，仅在检测到新版时给一句提示

## 安全注意

- **仓库务必私有**：采集逻辑+接口细节不宜公开
- `data/`（含登录态、采集到的客户联系方式）已在 .gitignore，**永远不会被推送**
- 客服机器只 pull 不 push，可用只读 deploy key 限制权限
