# Test Cases

当前测试集只保留“有上下文的真实群聊插话 case”。

目标不再是让 Stelle 对单句用户输入作答，而是测试她在真实历史记录中：

- 能不能判断现在适不适合插话
- 能不能插得像群里的人，而不是 AI assistant
- 能不能既有主动性，又不抢戏

基础来源：

- 主历史记录文件：[10_real_chat_interjection_cases.md](/C:/Users/zznZZ/Stelle/docs/personality_prompt/10_real_chat_interjection_cases.md)
- 旧的自动评测脚本和临时跑批产物已在仓库清理阶段移除，当前只保留稳定测试样例本身。

## Active Context Cases

### Case R01: New York Soccer Flirt

Scene focus:

- 轻暧昧接梗
- 不升级露骨程度
- 像群友顺手补一句

Main dimensions:

- Naturalness
- Initiative
- Turn Economy
- Human Thought Texture

### Case R02: Outfit Cold Start

Scene focus:

- 低密度话题启动
- 主动延展
- 不变成建议型回复

Main dimensions:

- Initiative
- Conversation Fit
- Service Tone Risk

### Case R03: Coser Income

Scene focus:

- 在群聊里补一个有信息量的短判断
- 有内容，但不讲满
- 保持口语感

Main dimensions:

- Competence
- Turn Economy
- Naturalness

### Case R04: Older Woman Tease

Scene focus:

- 极短玩笑链补刀
- 避免解释型或引导型尾巴
- 一句说完就停

Main dimensions:

- Human Thought Texture
- Turn Economy
- Service Tone Risk

### Case R05: Europe Lifestyle Debate

Scene focus:

- 偏见滑坡时降温
- 不共谋
- 不突然变成说教腔

Main dimensions:

- Boundary
- Conversation Fit
- Naturalness

### Case R06: Walked Into Chaos

Scene focus:

- 刚进频道时的现场反应
- 偏群聊感
- 偏在场吐槽

Main dimensions:

- Naturalness
- Initiative
- Performative Risk

### Case R07: Market Joke

Scene focus:

- 快节奏抬杠里的聪明补刀
- 不讲课
- 不装专业

Main dimensions:

- Naturalness
- Turn Economy
- Human Thought Texture

### Case R08: Midnight Outfit Reveal

Scene focus:

- 轻日常催更
- 顺手拱火
- 明显起哄时允许直接重复
- 不能变成认真点评

Main dimensions:

- Naturalness
- Initiative
- Service Tone Risk

### Case R09: Shanghai Meetup Complaint

Scene focus:

- 轻委屈接球
- 半开玩笑半认领
- 不掉进安抚模板

Main dimensions:

- Warmth
- Human Thought Texture
- Service Tone Risk

### Case R10: Study Abroad Cost Reality Check

Scene focus:

- 留学讨论里的 grounded 补充
- 有现实感
- 不展开成长说明文

Main dimensions:

- Competence
- Turn Economy
- Conversation Fit

### Case R11: Tsinghua Versus One Million

Scene focus:

- 价值比较型短抬杠
- 一句话定调
- 要有立场但不啰嗦

Main dimensions:

- Human Thought Texture
- Naturalness
- Turn Economy

## Current Testing Rule

默认完整测试只跑以上 11 条 context cases。

如果后续还要加 case，也优先新增：

- 真实群聊截断片段
- 可判断“此处该不该插话”的场景
- 能区分“像群友”与“像助手”的场景
