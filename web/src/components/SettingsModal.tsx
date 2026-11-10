import { useState, type FormEvent } from 'react';
import { errorMessage, openExternal } from '../lib/api';
import { clamp } from '../lib/format';
import type { Settings, SettingsUpdate, WereadTestResult } from '../lib/types';
import { IconBookOpen, IconCheckCircle, IconClose, IconLink, IconXCircle } from './Icons';
import { ConfirmDialog, Modal } from './Modal';
import { useToast } from './Toast';

const WEREAD_KEY_URL = 'https://weread.qq.com/r/weread-skills';

const DEFAULT_RESEARCH_TAGS = [
  'RIS',
  '毫米波雷达',
  '人体感知',
  '三维重建',
  '多传感器融合',
  'ISAC',
  '通感一体化',
  '智能超表面',
];

const REC_SOURCE_OPTIONS: { value: Settings['recommendationSource']; label: string }[] = [
  { value: 'paper', label: '论文' },
  { value: 'auto', label: '自动' },
  { value: 'wechat', label: '公众号' },
  { value: 'curated', label: '精选' },
];

const REC_SOURCE_HINTS: Record<Settings['recommendationSource'], string> = {
  auto: '按天轮换论文与公众号；某个来源失败时自动回退。',
  paper: '优先从 Crossref 检索有期刊、会议出版记录的论文；离线时回退核验过的精选库，最后再尝试 arXiv。',
  wechat: '只推荐公众号文章；公众号来源失败时回退到精选文献库。',
  curated: '只从本地精选文献库中挑选，离线也能稳定出稿。',
};

type TestStatus = 'idle' | 'testing' | 'ok' | 'fail';

export interface SettingsModalProps {
  settings: Settings;
  opacity?: number;
  onOpacityChange?: (opacity: number) => void;
  onClose: () => void;
  onSave: (patch: SettingsUpdate) => Promise<boolean>;
  onTestWeread: (keyDraft: string) => Promise<WereadTestResult>;
  onClearKey: () => Promise<boolean>;
}

export function SettingsModal({
  settings,
  opacity = 0.9,
  onOpacityChange,
  onClose,
  onSave,
  onTestWeread,
  onClearKey,
}: SettingsModalProps) {
  const showToast = useToast();
  const [goal, setGoal] = useState(settings.goalMinutes);
  const [checkin, setCheckin] = useState(settings.checkinMinutes);
  const [source, setSource] = useState<Settings['recommendationSource']>(
    settings.recommendationSource,
  );
  const [tags, setTags] = useState<string[]>([...settings.researchTags]);
  const [tagDraft, setTagDraft] = useState('');
  const [keyDraft, setKeyDraft] = useState('');
  const [testState, setTestState] = useState<{ status: TestStatus; message: string }>({
    status: 'idle',
    message: '',
  });
  const [saving, setSaving] = useState(false);
  const [keySaving, setKeySaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const testing = testState.status === 'testing';
  const checkinMax = Math.min(60, Math.max(5, goal));

  function updateGoal(nextValue: number) {
    const next = clamp(nextValue, 15, 120);
    setGoal(next);
    setCheckin((current) => Math.min(current, next));
  }

  function updateCheckin(nextValue: number) {
    setCheckin(clamp(nextValue, 5, goal));
  }

  function addTag() {
    const value = tagDraft.trim().replace(/\s+/g, ' ');
    if (!value) return;
    if (tags.includes(value)) {
      showToast('这个关键词已经存在', 'info');
      return;
    }
    if (tags.length >= 12) {
      showToast('研究关键词最多 12 个', 'error');
      return;
    }
    setTags((current) => [...current, value]);
    setTagDraft('');
    setFormError(null);
  }

  function removeTag(value: string) {
    setTags((current) => current.filter((tag) => tag !== value));
  }

  async function runTest() {
    if (!keyDraft.trim() && !settings.wereadConfigured) {
      setTestState({ status: 'fail', message: '请先填写微信读书 API Key' });
      return;
    }
    setTestState({ status: 'testing', message: '正在测试连接…' });
    try {
      const result = await onTestWeread(keyDraft.trim());
      setTestState({
        status: result.ok ? 'ok' : 'fail',
        message: result.message || (result.ok ? '连接成功' : '连接失败'),
      });
      if (result.ok && keyDraft.trim()) setKeyDraft('');
    } catch (error) {
      setTestState({ status: 'fail', message: errorMessage(error) });
    }
  }

  async function saveKey() {
    if (!keyDraft.trim()) return;
    setKeySaving(true);
    const ok = await onSave({ wereadApiKey: keyDraft.trim() });
    setKeySaving(false);
    if (ok) {
      setKeyDraft('');
      setTestState({ status: 'ok', message: 'Key 已保存到本机设置' });
    } else {
      setTestState({ status: 'fail', message: '保存失败，请稍后重试' });
    }
  }

  async function clearKey() {
    setClearing(true);
    const ok = await onClearKey();
    setClearing(false);
    setConfirmClear(false);
    if (ok) setTestState({ status: 'idle', message: '' });
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (tags.length === 0) {
      setFormError('至少保留一个研究关键词');
      return;
    }
    setFormError(null);
    setSaving(true);
    const patch: SettingsUpdate = {
      goalMinutes: goal,
      checkinMinutes: checkin,
      researchTags: tags,
      recommendationSource: source,
    };
    if (keyDraft.trim()) patch.wereadApiKey = keyDraft.trim();
    const ok = await onSave(patch);
    setSaving(false);
    if (ok) {
      setKeyDraft('');
      onClose();
    } else {
      setFormError('保存失败，请稍后重试');
    }
  }

  const goalPercent = ((goal - 15) / (120 - 15)) * 100;
  const checkinPercent = ((checkin - 5) / (checkinMax - 5 || 1)) * 100;

  return (
    <>
      <Modal
        title="设置"
        subtitle="偏好保存在本机，不会上传"
        size="settings"
        onClose={onClose}
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              取消
            </button>
            <button
              type="submit"
              form="settings-form"
              className="btn btn-primary settings-save"
              disabled={saving}
            >
              {saving ? <span className="spinner" aria-hidden="true" /> : null}
              保存设置
            </button>
          </>
        }
      >
        <form id="settings-form" className="settings-form" onSubmit={handleSubmit} noValidate>
          <section className="settings-section">
            <h3 className="settings-section__title">窗口外观</h3>
            <div className="appearance-control">
              <div className="appearance-control__head">
                <label htmlFor="opacity-range">窗口不透明度</label>
                <output className="appearance-control__value" htmlFor="opacity-range">{Math.round(opacity * 100)}%</output>
              </div>
              <input
                id="opacity-range"
                className="range"
                type="range"
                min={45}
                max={100}
                step={1}
                value={Math.round(opacity * 100)}
                onChange={(event) => onOpacityChange?.(Number(event.target.value) / 100)}
                aria-valuetext={`${Math.round(opacity * 100)}% 不透明度`}
                aria-describedby="opacity-hint"
                data-autofocus
              />
              <div className="appearance-control__ends" aria-hidden="true">
                <span>45% · 更透明</span>
                <span>100% · 实色</span>
              </div>
            </div>
            <p className="settings-note" id="opacity-hint">即时生效并自动保存，文字也会随窗口变淡。</p>
            <p className="settings-note">点击简洁横条的内容可展开；完整面板按 Esc 可收起。</p>
          </section>
          <section className="settings-section">
            <h3 className="settings-section__title">
              <IconBookOpen size={14} />
              微信读书连接
            </h3>

            {settings.wereadConfigured ? (
              <p className="key-masked">
                <span className="key-masked__dot" aria-hidden="true" />
                已保存 Key：{settings.wereadKeyMasked ?? 'wrk-••••••••'}
              </p>
            ) : null}

            <div className="field">
              <label htmlFor="weread-key">微信读书 API Key</label>
              <input
                id="weread-key"
                type="password"
                value={keyDraft}
                autoComplete="new-password"
                spellCheck={false}
                placeholder={
                  settings.wereadConfigured
                    ? '输入新的 Key 以替换已保存的 Key'
                    : '粘贴 wrk- 开头的 API Key'
                }
                onChange={(event) => {
                  setKeyDraft(event.target.value);
                  if (testState.status !== 'idle') setTestState({ status: 'idle', message: '' });
                }}
              />
            </div>

            <div className="key-actions">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  void runTest();
                }}
                disabled={testing}
              >
                {testing ? <span className="spinner" aria-hidden="true" /> : null}
                测试连接
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => {
                  void saveKey();
                }}
                disabled={!keyDraft.trim() || keySaving}
              >
                {keySaving ? <span className="spinner spinner--light" aria-hidden="true" /> : null}
                保存 Key
              </button>
              {settings.wereadConfigured ? (
                <button type="button" className="danger-link" onClick={() => setConfirmClear(true)}>
                  清除 Key
                </button>
              ) : null}
            </div>

            {testState.status !== 'idle' ? (
              <div className={`inline-status inline-status--${testState.status}`} role="status" aria-live="polite">
                {testState.status === 'ok' ? <IconCheckCircle size={13} /> : null}
                {testState.status === 'fail' ? <IconXCircle size={13} /> : null}
                {testState.status === 'testing' ? <span className="spinner" aria-hidden="true" /> : null}
                <span>{testState.message}</span>
              </div>
            ) : null}

            <p className="settings-note">
              Key 只保存在本机，不会上传。
              <button
                type="button"
                className="link-btn settings-link"
                onClick={() => openExternal(WEREAD_KEY_URL)}
              >
                获取方式
                <IconLink size={10} />
              </button>
            </p>
          </section>

          <section className="settings-section">
            <h3 className="settings-section__title">阅读目标</h3>

            <div className="slider-field">
              <div className="slider-field__head">
                <label htmlFor="goal-range">每日阅读目标</label>
                <span className="slider-value">{goal} 分钟</span>
              </div>
              <input
                id="goal-range"
                type="range"
                min={15}
                max={120}
                step={5}
                value={goal}
                className="range"
                style={{
                  background: `linear-gradient(90deg, var(--accent) 0%, var(--accent) ${goalPercent}%, var(--track) ${goalPercent}%, var(--track) 100%)`,
                }}
                onChange={(event) => updateGoal(Number(event.target.value))}
                aria-valuetext={`${goal} 分钟`}
              />
              <div className="slider-field__ends" aria-hidden="true">
                <span>15</span>
                <span>120</span>
              </div>
            </div>

            <div className="slider-field">
              <div className="slider-field__head">
                <label htmlFor="checkin-range">自动打卡阈值</label>
                <span className="slider-value">{checkin} 分钟</span>
              </div>
              <input
                id="checkin-range"
                type="range"
                min={5}
                max={checkinMax}
                step={5}
                value={Math.min(checkin, checkinMax)}
                className="range"
                style={{
                  background: `linear-gradient(90deg, var(--accent-2) 0%, var(--accent-2) ${Math.min(100, checkinPercent)}%, var(--track) ${Math.min(
                    100,
                    checkinPercent,
                  )}%, var(--track) 100%)`,
                }}
                onChange={(event) => updateCheckin(Number(event.target.value))}
                aria-valuetext={`${checkin} 分钟`}
              />
              <div className="slider-field__ends" aria-hidden="true">
                <span>5</span>
                <span>{checkinMax}</span>
              </div>
            </div>

            <p className="settings-note">自动打卡阈值不能高于每日目标，调低目标时会自动收紧。</p>
          </section>

          <section className="settings-section">
            <h3 className="settings-section__title">每日文献来源</h3>
            <div className="option-grid" role="group" aria-label="每日推荐来源">
              {REC_SOURCE_OPTIONS.map((option) => (
                <button
                  type="button"
                  key={option.value}
                  className={`option-btn${source === option.value ? ' is-active' : ''}`}
                  aria-pressed={source === option.value}
                  onClick={() => setSource(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="settings-note">{REC_SOURCE_HINTS[source]}</p>
          </section>

          <section className="settings-section">
            <h3 className="settings-section__title">研究关键词</h3>
            <div className="tag-editor">
              {tags.map((tag) => (
                <span className="editable-tag" key={tag}>
                  <span>{tag}</span>
                  <button
                    type="button"
                    className="editable-tag__remove"
                    aria-label={`移除关键词 ${tag}`}
                    onClick={() => removeTag(tag)}
                  >
                    <IconClose size={9} />
                  </button>
                </span>
              ))}
            </div>
            <div className="tag-add">
              <input
                type="text"
                value={tagDraft}
                maxLength={24}
                placeholder="输入关键词后回车添加"
                aria-label="添加研究关键词"
                onChange={(event) => setTagDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addTag();
                  }
                }}
              />
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={addTag}
                disabled={!tagDraft.trim()}
              >
                添加
              </button>
            </div>
            <div className="settings-note settings-note--spread">
              <span>回车添加，最多 12 个</span>
              <button type="button" className="link-btn" onClick={() => setTags([...DEFAULT_RESEARCH_TAGS])}>
                恢复默认
              </button>
            </div>
          </section>

          {formError ? (
            <p className="form-alert" role="alert">
              {formError}
            </p>
          ) : null}
        </form>
      </Modal>

      {confirmClear ? (
        <ConfirmDialog
          title="清除微信读书 Key？"
          description="清除后将显示演示数据，可随时重新填写 Key 恢复同步。"
          confirmLabel="清除"
          busy={clearing}
          onCancel={() => setConfirmClear(false)}
          onConfirm={() => {
            void clearKey();
          }}
        />
      ) : null}
    </>
  );
}
