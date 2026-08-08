# MedPrism 模板库（内置官方包）

官方出版社模板以**文件夹**形式 vendored 在：

```
templates/official/<template-id>/
```

新建项目时直接复制该目录中的文本源码，**用户无需再下载 zip**。

## 内置目录

| 文件夹 ID | 来源 |
|---|---|
| `springer-nature-sn-jnl` | Springer Nature journal article template（官方 CMS 包） |
| `elsevier-elsarticle` | CTAN `elsarticle` |
| `ieee-journal` | CTAN `IEEEtran` |
| `acm-acmart` | CTAN `acmart`（`acmart.cls` / samples 由 DocStrip 生成） |

每个目录含 `SOURCE.txt` 标明来源 URL。为控制体积，已去掉 PDF/图片、文档子目录与临时文件；写作所需的 class/bst/tex/bib 保留。

## 实现

- Catalog：`src/templates/catalog.ts`
- 加载：`src/templates/loadBundled.ts`（`import.meta.glob` → 官方文件夹）
- 预处理：`node scripts/prepare-official-templates.mjs`（生成 `elsarticle.cls` / `acmart.cls` / ACM samples）

## 更新官方包

1. 用出版社/CTAN 最新 zip 覆盖对应 `templates/official/<id>/`
2. 运行 `node scripts/prepare-official-templates.mjs`
3. 更新该目录 `SOURCE.txt` 与本表

## Demo

首屏 sepsis demo（`demo-sample`）仍是 UI 演示稿，不是官方模板。
