import React from 'react';
import { DS } from './design-system';

interface ModelPickerProps {
  currentModel: string;
  onModelChange: (model: string) => void;
}

const MODELS = [
  { id: 'gemini-2.5-flash', label: 'Flash', description: 'Gemini Flash — fast, cheap, great for browsing' },
  { id: 'gemini-2.5-pro', label: 'Pro', description: 'Gemini Pro — most capable' },
  { id: 'claude-sonnet-4-5', label: 'Sonnet', description: 'Claude fallback (via worker)' },
];

export const ModelPicker: React.FC<ModelPickerProps> = ({ currentModel, onModelChange }) => {
  return (
    <div style={{
      display: 'flex',
      gap: '2px',
      backgroundColor: DS.colors.surface1,
      borderRadius: DS.borderRadius.md,
      padding: '2px',
      border: `1px solid ${DS.colors.border}`,
    }}>
      {MODELS.map((model) => {
        const isSelected = currentModel === model.id;
        return (
          <button
            key={model.id}
            onClick={() => onModelChange(model.id)}
            title={model.description}
            style={{
              padding: '3px 10px',
              borderRadius: DS.borderRadius.sm,
              border: 'none',
              backgroundColor: isSelected ? DS.colors.accent : 'transparent',
              color: isSelected ? '#000000' : DS.colors.textMuted,
              fontSize: DS.typography.sizes.xs,
              fontWeight: isSelected ? DS.typography.weights.bold : DS.typography.weights.normal,
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              fontFamily: DS.typography.fontFamily,
            }}
          >
            {model.label}
          </button>
        );
      })}
    </div>
  );
};

