import type { LlmClient } from "../../model/llm.js";
import { moderateText } from "../../perception/text_ingress/text_moderation.js";
import { sanitizeExternalText, truncateText } from "../../../shared/text.js";

// === Types ===

export interface PromptLabVariant {
  id: string;
  label: string;
  style: string;
  output: string;
}

export interface PromptLabExperiment {
  id: string;
  question: string;
  variants: PromptLabVariant[];
  createdAt: number;
  safetyNote: string;
}

// === Constants ===

const DEFAULT_VARIANTS = [
  { label: "严厉老师", style: "像严格但负责的老师，短句指出问题。" },
  { label: "理性审稿人", style: "像理性审稿人，指出假设和改进方向。" },
  { label: "阴阳怪气客服", style: "像阴阳怪气但不攻击人的客服，保持安全边界。" },
  { label: "Stelle 本体", style: "像 Stelle 正常直播语气，亲切、简短、会接梗。" },
];

// === Service ===

export class PromptLabService {
  private recent: PromptLabExperiment[] = [];

  constructor(private readonly llm?: LlmClient) {}

  async run(question: string, variants = DEFAULT_VARIANTS): Promise<PromptLabExperiment> {
    const cleanQuestion = truncateText(sanitizeExternalText(question), 240);
    const moderation = moderateText(cleanQuestion);
    if (!moderation.allowed) throw new Error(`Prompt lab rejected unsafe input: ${moderation.reason}`);

    const selectedVariants = variants.slice(0, 4);
    const outputs: PromptLabVariant[] = await Promise.all(
      selectedVariants.map(async (variant, index) => ({
        id: `variant-${index + 1}`,
        label: variant.label,
        style: variant.style,
        output: await this.renderVariant(cleanQuestion, variant.style),
      })),
    );

    const experiment: PromptLabExperiment = {
      id: `prompt-lab-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      question: cleanQuestion,
      variants: outputs,
      createdAt: Date.now(),
      safetyNote: "Sandbox only; outputs are not written to core identity or runtime policy.",
    };

    this.recent = [experiment, ...this.recent].slice(0, 6);
    return experiment;
  }

  list(): PromptLabExperiment[] {
    return [...this.recent];
  }

  private async renderVariant(question: string, style: string): Promise<string> {
    if (!this.llm?.config.primary.apiKey && !this.llm?.config.secondary.apiKey) {
      return truncateText(`${style} 回答：我会先把问题拆小，再给一个可执行的下一步。`, 180);
    }
    const prompt = [
      "You are running a sandboxed program Prompt Lab experiment.",
      "Do not update Stelle's identity, memory, system prompt, or operating rules.",
      "Return one short Simplified Chinese answer only.",
      `Style: ${style}`,
      `Question: ${question}`,
    ].join("\n\n");
    const text = await this.llm.generateText(prompt, { role: "secondary", temperature: 0.7, maxOutputTokens: 240 });
    return truncateText(sanitizeExternalText(text), 220);
  }
}
