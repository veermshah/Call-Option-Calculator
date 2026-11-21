import { useState } from 'react'
import type { Settings } from '@shared/ipc'
import { api, isDesktop } from '../lib/api'

interface Props {
  settings: Settings
  onClose: () => void
  onSaved: (s: Settings) => void
}

const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (default)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (faster, cheaper)' },
  { id: 'claude-fable-5-2', label: 'Claude Fable 5.2 (most capable)' }
]

export function SettingsModal({ settings, onClose, onSaved }: Props) {
  const [key, setKey] = useState('')
  const [model, setModel] = useState(settings.model)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    let s = settings
    if (key.trim()) s = await api.setApiKey(key)
    if (model !== settings.model) s = await api.setModel(model)
    setSaving(false)
    onSaved(s)
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Settings</h2>
        <label>
          Anthropic API key
          <input
            type="password"
            value={key}
            autoFocus
            placeholder={settings.hasApiKey ? '•••••••• saved — paste a new key to replace' : 'sk-ant-…'}
            onChange={(e) => setKey(e.target.value)}
          />
          <small>
            {isDesktop
              ? 'Stored on this computer, encrypted with your OS keychain. Falls back to the ANTHROPIC_API_KEY environment variable.'
              : 'Stored only in this browser. Requests go straight from your browser to api.anthropic.com; this site never sees your key.'}
          </small>
        </label>
        <label>
          Model
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
            {!MODELS.some((m) => m.id === model) && <option value={model}>{model}</option>}
          </select>
        </label>
        <div className="modal-actions">
          {settings.hasApiKey && (
            <button
              className="danger"
              onClick={async () => onSaved(await api.setApiKey(''))}
            >
              Remove saved key
            </button>
          )}
          <span className="spacer" />
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={saving} onClick={save}>Save</button>
        </div>
      </div>
    </div>
  )
}
