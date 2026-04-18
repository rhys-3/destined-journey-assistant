/**
 * build.js
 * 构建脚本：将 src/ 下的模块按依赖顺序合并为单文件 IIFE
 *
 * 功能说明：
 * - 读取 src/ 目录下的所有模块文件
 * - 按照依赖关系的拓扑顺序合并代码
 * - 使用 IIFE（立即执行函数）包装，避免全局作用域污染
 * - 输出可直接在 SillyTavern 中使用的单文件脚本
 *
 * 用法: node build.js
 * 输出: dist/destined-journey-summarizer.js
 *
 * @author Rhys_z_瑞
 * @version 2.8.2
 */

const fs = require("fs");
const path = require("path");

/**
 * 模块加载顺序（按依赖拓扑排序）
 *
 * 依赖层级：
 * Level 0: errorHandler, config, ui/styles (无依赖)
 * Level 1: utils, storage (依赖 Level 0)
 * Level 2: messages, worldbook (依赖 Level 0-1)
 * Level 3: api, prompt, ui/renderer (依赖 Level 0-2)
 * Level 4: summary, ui/panel (依赖 Level 0-3)
 * Level 5: ui/panelEvents, index (依赖 Level 0-4)
 */
const MODULE_ORDER = [
  "src/errorHandler.js", // 错误处理包装器
  "src/config.js", // 配置常量
  "src/utils.js", // 通用工具函数
  "src/storage.js", // 设置存储管理
  "src/messages.js", // 聊天消息处理
  "src/api.js", // API 调用封装
  "src/worldbook.js", // 世界书管理
  "src/prompt.js", // 提示词构建
  "src/summary.js", // 总结流程控制
  "src/ui/styles.js", // UI 样式定义
  "src/ui/renderer.js", // 视图渲染器
  "src/ui/panel.js", // 设置面板
  "src/ui/panelEvents.js", // 面板事件处理
  "src/index.js", // 主入口
];

// 构建输出配置
const OUTPUT_DIR = "dist";
const OUTPUT_FILE = "destined-journey-summarizer.js";

/**
 * 主构建函数
 *
 * 流程：
 * 1. 读取所有模块文件
 * 2. 按顺序合并代码
 * 3. 添加 IIFE 包装
 * 4. 输出到 dist 目录
 */
function build() {
  const baseDir = __dirname;
  const parts = [];

  // 添加文件头和 IIFE 开始
  parts.push(`
/**
 * 命定之诗总结助手 V2.8.2 - 合并后的单文件脚本
 *
 * 本文件由构建脚本自动生成，请勿手动修改
 * 构建时间: ${new Date().toISOString()}
 *
 * @author Rhys_z_瑞
 * @version 2.8.2
 * @license MIT
 */

(function() {
'use strict';
`);

  // 按顺序读取并拼接模块
  console.log("📦 开始构建...\n");
  for (const modulePath of MODULE_ORDER) {
    const fullPath = path.join(baseDir, modulePath);

    // 检查文件是否存在
    if (!fs.existsSync(fullPath)) {
      console.error(`❌ [ERROR] 模块文件不存在: ${modulePath}`);
      process.exit(1);
    }

    // 读取模块内容
    const content = fs.readFileSync(fullPath, "utf-8");
    const sectionName = modulePath.replace("src/", "");

    // 添加模块分隔符和内容
    parts.push(
      `// ============================================================`,
    );
    parts.push(`//  ${sectionName}`);
    parts.push(
      `// ============================================================`,
    );
    parts.push(content);
    parts.push("");

    console.log(`   ✓ ${modulePath}`);
  }

  // 添加 IIFE 结束
  parts.push(`})();`);

  // 确保输出目录存在
  const outDir = path.join(baseDir, OUTPUT_DIR);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  // 写入输出文件
  const outPath = path.join(outDir, OUTPUT_FILE);
  fs.writeFileSync(outPath, parts.join("\n"), "utf-8");

  // 输出构建信息
  const stats = fs.statSync(outPath);
  console.log("\n✅ 构建成功！");
  console.log(`   输出文件: ${outPath}`);
  console.log(`   文件大小: ${(stats.size / 1024).toFixed(1)} KB`);
  console.log(`   模块数量: ${MODULE_ORDER.length} 个`);
  console.log(`   构建时间: ${new Date().toLocaleString("zh-CN")}`);
}

// 执行构建
build();
