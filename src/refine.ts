// Reiner Kern: baut aus (Original + Feedback-Verlauf + neuem Feedback) ein Multi-Turn-Chat-
// Messages-Array für die iterative Nachbesserung. Obsidian-/DOM-frei (PROF-OBS-03/04).
// Der Basistext hängt bewusst nur an der ERSTEN User-Message; die Assistant-Turns sind die
// bisherigen Versionen — so bekommt das Modell den Verlauf in genau der Form, auf die
// Chat-Completions trainiert sind (keine flachgeklopfte Inline-Historie).

export interface RefineStep { feedback: string; text: string; }
export interface ChatMessage { role: "system" | "user" | "assistant"; content: string; }

export function buildRefineMessages(base: string, steps: RefineStep[], feedback: string, systemPrompt: string): ChatMessage[] {
  const msgs: ChatMessage[] = [{ role: "system", content: systemPrompt }];
  const firstFeedback = steps.length ? steps[0].feedback : feedback;
  msgs.push({ role: "user", content: `${firstFeedback}\n\n---\n\n${base}` });
  for (let k = 0; k < steps.length; k++) {
    msgs.push({ role: "assistant", content: steps[k].text });
    const nextFeedback = k + 1 < steps.length ? steps[k + 1].feedback : feedback;
    msgs.push({ role: "user", content: nextFeedback });
  }
  return msgs;
}
