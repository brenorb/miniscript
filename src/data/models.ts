export const supportedModels = [
  {
    id: 'Qwen2.5-0.5B-Instruct-q4f32_1-MLC',
    label: 'Qwen 2.5 0.5B',
    note: 'Smallest download, best for quick local iteration.',
  },
  {
    id: 'Qwen2.5-1.5B-Instruct-q4f32_1-MLC',
    label: 'Qwen 2.5 1.5B',
    note: 'Better reasoning while staying lightweight.',
  },
  {
    id: 'Llama-3.2-1B-Instruct-q4f32_1-MLC',
    label: 'Llama 3.2 1B',
    note: 'Another compact local option.',
  },
] as const

export type SupportedModelId = (typeof supportedModels)[number]['id']
