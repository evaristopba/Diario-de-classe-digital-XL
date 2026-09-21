import React from 'react';
import { ModalConfig } from '../types';

interface ModalProps {
  config: ModalConfig;
  onClose: () => void;
}

export const Modal: React.FC<ModalProps> = ({ config, onClose }) => {
  if (!config.isOpen) return null;

  return (
    <div
      id="modal-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs animate-in fade-in duration-200"
    >
      <div
        id="modal-card"
        className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl transition-all sm:p-8 max-h-[90dvh] overflow-y-auto"
      >
        <div className="text-center">
          {config.icon && <div className="text-5xl mb-3">{config.icon}</div>}
          {config.title && (
            <h3 className="text-xl font-bold text-gray-800 mb-2">{config.title}</h3>
          )}
          {config.message && (
            <div className="text-sm text-gray-600 mb-6 leading-relaxed whitespace-pre-line text-left bg-gray-50 p-3 rounded-lg border border-gray-100">
              {config.message}
            </div>
          )}
          {config.children}
        </div>

        <div className="mt-6 flex flex-wrap justify-center gap-3">
          {config.type === 'confirm' ? (
            <>
              <button
                id="modal-cancel-btn"
                type="button"
                onClick={() => {
                  if (config.onCancel) config.onCancel();
                  onClose();
                }}
                className="px-5 py-2.5 rounded-xl border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 font-medium text-sm transition-colors shadow-xs"
              >
                {config.cancelText || 'Não, cancelar'}
              </button>
              <button
                id="modal-confirm-btn"
                type="button"
                onClick={() => {
                  if (config.onConfirm) config.onConfirm();
                  onClose();
                }}
                className={`px-5 py-2.5 rounded-xl text-white font-medium text-sm transition-colors shadow-xs ${
                  config.danger
                    ? 'bg-rose-600 hover:bg-rose-700'
                    : 'bg-indigo-600 hover:bg-indigo-700'
                }`}
              >
                {config.confirmText || 'Sim, confirmar'}
              </button>
            </>
          ) : (
            <button
              id="modal-ok-btn"
              type="button"
              onClick={onClose}
              className="px-6 py-2.5 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 font-medium text-sm transition-colors shadow-xs"
            >
              OK, entendi
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
