// Builds data/seed/curated_papers.json from real arXiv records gathered into
// artifacts/arxiv-candidates*.json. Re-run only when refreshing the curated pool.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const entries = [
  {
    id: '2610.27695v1',
    venue: 'IEEE Communications Magazine',
    year: 2026,
    tags: ['RIS', 'ISAC', '通感一体化'],
    summary: '综述RIS如何同时增强6G通信与感知，梳理无源/有源感知范式、波束设计与系统架构，并指出开放挑战。',
  },
  {
    id: '2610.23602v1',
    venue: 'SCIENCE CHINA Information Sciences',
    year: 2026,
    tags: ['ISAC', '通感一体化'],
    summary: '面向低空经济提出通信-感知-识别一体化框架，总结系统架构、统一信号模型与性能指标，并讨论关键挑战。',
  },
  {
    id: '2609.22314v2',
    venue: 'arXiv 预印本',
    year: 2026,
    tags: ['ISAC', '通感一体化'],
    summary: '一本ISAC系统教程：从复基带信号、模糊函数与CRB讲到MIMO容量与预编码，最后统一到6G系统设计。',
  },
  {
    id: '2607.16611v1',
    venue: 'arXiv 预印本',
    year: 2026,
    tags: ['RIS', 'ISAC'],
    summary: '分析杂波环境下RIS辅助ISAC的通信与感知性能，推导遍历容量与检测概率的闭式或近似表达式。',
  },
  {
    id: '2606.28924v1',
    venue: 'arXiv 预印本',
    year: 2026,
    tags: ['RIS', 'ISAC', '通感一体化'],
    summary: '设计PMCW双功能波形，把数据嵌入雷达脉冲串，并给出以通信为中心的RIS相位配置与误码率分析。',
  },
  {
    id: '2608.23422v1',
    venue: 'arXiv 预印本',
    year: 2026,
    tags: ['RIS', 'ISAC'],
    summary: '针对雷达通信共存中的随机干扰与RIS相位误差，推导两种实用最大似然检测器并分析检测性能。',
  },
  {
    id: '2610.03643v1',
    venue: 'IEEE CCNC 2027',
    year: 2027,
    tags: ['RIS', '毫米波雷达', '人体感知'],
    summary: '用SAC强化学习控制RIS相位，辅助单脉冲雷达在多径室内环境中稳健定位呼吸等生命体征。',
  },
  {
    id: '2206.06172v2',
    venue: 'IEEE Communications Letters',
    year: 2024,
    tags: ['RIS', '毫米波雷达'],
    summary: '用原子范数最小化与ADMM做RIS辅助无源DOA估计，在干扰下保持稀疏重构精度并降低计算复杂度。',
  },
  {
    id: '2608.07444v1',
    venue: 'IEEE GLOBECOM 2026',
    year: 2026,
    tags: ['RIS', '毫米波雷达'],
    summary: '用RIS波束域SNR/SINR指纹和机器学习做毫米波定位，在交叉链路干扰下无需CSI即可估计方位与距离。',
  },
  {
    id: '2610.17566v1',
    venue: 'arXiv 预印本',
    year: 2026,
    tags: ['RIS', '人体感知'],
    summary: '比较物理建模与深度学习两种先验，从少量基站测量重建超大RIS阵元观测，用于近场目标定位。',
  },
  {
    id: '2610.34088v1',
    venue: 'arXiv 预印本',
    year: 2026,
    tags: ['RIS', 'ISAC'],
    summary: '证明可移动超对角RIS可解耦感知与保密通信，并给出零迫设计，在目标即窃听者时抑制数据泄漏。',
  },
  {
    id: '2610.25798v1',
    venue: 'arXiv 预印本',
    year: 2026,
    tags: ['RIS', 'ISAC'],
    summary: '面向STAR-RIS辅助ISAC，提出模型驱动深度学习方法联合优化发射波束与波形，降低对全局CSI的依赖。',
  },
  {
    id: '2610.27774v1',
    venue: 'arXiv 预印本',
    year: 2026,
    tags: ['毫米波雷达', '人体感知', '三维重建'],
    summary: '提出I2R-Pose两阶段框架：先用运动先验初始化关节，再用观测引导细化，缓解雷达点云稀疏与遮挡。',
  },
  {
    id: '2607.18875v1',
    venue: 'arXiv 预印本',
    year: 2026,
    tags: ['毫米波雷达', '人体感知', '三维重建'],
    summary: '把毫米波人体姿态估计重构为“雷达token→人体token”翻译，用自监督雷达分词器与人体组合分词器解耦学习目标。',
  },
  {
    id: '2603.14507v3',
    venue: 'CVPR 2026',
    year: 2026,
    tags: ['毫米波雷达', '人体感知', '多传感器融合'],
    summary: '用伪标签与LiDAR点云转换扩充毫米波人体姿态数据集，域内和跨域误差分别降低15.1%和18.9%。',
  },
  {
    id: '2210.01346v3',
    venue: 'ICRA 2023',
    year: 2023,
    tags: ['毫米波雷达', '三维重建', '多传感器融合'],
    summary: '首个毫米波- RGB融合的人体三维重建方案，用Transformer动态融合两种模态，在恶劣天气下仍能稳健恢复人体网格。',
  },
  {
    id: '2609.39098v1',
    venue: 'IROS 2026',
    year: 2026,
    tags: ['毫米波雷达', '人体感知', '多传感器融合'],
    summary: '利用4D毫米波雷达的多普勒先验与KAN条件流匹配，从稀疏噪声点云估计非刚性人体运动流，服务人机交互。',
  },
  {
    id: '2509.21396v1',
    venue: 'arXiv 预印本',
    year: 2025,
    tags: ['ISAC', '人体感知', '毫米波雷达'],
    summary: '发布多模态分布式毫米波ISAC人体感知数据集，覆盖手势、身份、姿态与定位，并给出参数高效微调基线。',
  },
  {
    id: '2602.07139v1',
    venue: 'IEEE Internet of Things Journal',
    year: 2026,
    tags: ['毫米波雷达', '人体感知'],
    summary: '指出毫米波手势点云会泄漏身份信息，提出图自编码器在保留手势结构的同时混淆身份特征，兼顾隐私与识别。',
  },
  {
    id: '2610.36637v1',
    venue: 'arXiv 预印本',
    year: 2026,
    tags: ['毫米波雷达', '人体感知', '多传感器融合'],
    summary: '用摄像头2D关键点教师蒸馏雷达学生模型，软时间对齐解决模态帧率错位，只用雷达即可识别日常动作。',
  },
  {
    id: '2603.08540v1',
    venue: 'IEEE Internet of Things Journal',
    year: 2026,
    tags: ['毫米波雷达', '人体感知', '三维重建'],
    summary: '将毫米波点云建模为图，提出点/边/图三级特征提取与GNN架构，在姿态估计与动作识别基准上显著降误差。',
  },
  {
    id: '2507.13766v1',
    venue: 'arXiv 预印本',
    year: 2025,
    tags: ['ISAC', '人体感知', '通感一体化'],
    summary: '统一综述ISAC从人体生命体征/动作到降雨洪水等环境感知，梳理CSI、多普勒等信号特征与实际可行性。',
  },
];

const records = [];
for (const file of ['arxiv-candidates.json', 'arxiv-candidates2.json']) {
  const p = path.join(ROOT, 'artifacts', file);
  if (!fs.existsSync(p)) continue;
  const text = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
  for (const item of JSON.parse(text)) records.push(item);
}

const byId = new Map();
for (const record of records) {
  const id = record.id.split('/abs/').pop();
  if (id && !byId.has(id)) byId.set(id, record);
}

const pool = [];
for (const entry of entries) {
  const record = byId.get(entry.id);
  if (!record) {
    console.warn(`! missing arXiv record ${entry.id}`);
    continue;
  }
  const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  pool.push({
    title: clean(record.title),
    authors: (record.authors || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 3),
    venue: entry.venue,
    year: entry.year,
    url: `https://arxiv.org/abs/${entry.id.replace(/v\d+$/, '')}`,
    summary: entry.summary,
    tags: entry.tags,
    language: 'zh',
  });
}

const out = path.join(ROOT, 'data', 'seed', 'curated_papers.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(pool, null, 2) + '\n', 'utf8');
console.log(`wrote ${pool.length} curated papers -> ${out}`);
for (const item of pool) console.log(`- ${item.year} | ${item.venue} | ${item.title.slice(0, 70)}`);
