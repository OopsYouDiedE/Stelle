/**
 * Utility to generate conversational bridge sentences for topic transitions.
 */
export class BridgeGenerator {
  public static generate(title: string, fromPhase: string, toPhase: string): string {
    const templates: Record<string, string[]> = {
      "opening->sampling": [
        `那我们现在开始收集大家的看法吧，关于“{title}”，大家有什么想说的？`,
        `这就开始进入正题，关于“{title}”，我想听听你们的声音。`,
      ],
      "sampling->clustering": [
        `弹幕已经不少了，我来归类看下大家的关注点主要在哪里。`,
        `看来大家讨论得很热烈啊，我来梳理一下大家的几个主要方向。`,
      ],
      "clustering->debating": [
        `既然方向明确了，那我们深入聊聊其中几个有争议的点吧。`,
        `大家在这些点上似乎有不同的看法，我们来辩一辩。`,
      ],
      "debating->summarizing": [
        `聊得差不多了，我来试着总结一下目前的共识。`,
        `看来今天这个话题我们已经挖掘得很深了，最后我来做个归纳。`,
      ],
      "any->opening": [
        `好啦，那我们换个话题，聊聊“{title}”怎么样？`,
        `刚才那个聊完了，接下来我们把焦点转到“{title}”上。`,
      ],
    };

    const key = `${fromPhase}->${toPhase}`;
    const fallbackKey = `any->${toPhase}`;
    const options = templates[key] ?? templates[fallbackKey] ?? [`现在进入 ${toPhase} 阶段，关于 ${title}。`];
    
    const template = options[Math.floor(Math.random() * options.length)];
    return template.replace("{title}", title);
  }
}
