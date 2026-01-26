
import { GoogleGenAI } from "@google/genai";
import { AlertType } from "../types";

const FALLBACK_MESSAGE = (alertType: AlertType, triggererName: string) =>
  `EMERGENCY: ${alertType} reported by ${triggererName}. Neighbors have been notified. Please follow safety protocols immediately.`;

const createClient = () => {
  const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY || "";
  if (!apiKey || apiKey === "undefined") {
    return null;
  }
  try {
    return new GoogleGenAI({ apiKey });
  } catch (err) {
    console.error("Gemini client init failed", err);
    return null;
  }
};

export const getEvacuationPlan = async (alertType: AlertType, triggererName: string) => {
  const client = createClient();
  if (!client) {
    return FALLBACK_MESSAGE(alertType, triggererName);
  }

  try {
    const response = await client.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Generate a brief, authoritative emergency instruction for a ${alertType} alert reported by resident ${triggererName}.
      Contexts for Residential Safety:
      - FIRE: Evacuate immediately via stairs. Do not use elevators.
      - DISASTER: Take cover or move to open designated safe zones.
      - CRIME: Shelter in place, lock all entry points, wait for security.
      - INFESTATION: Seal vents and stay in designated clean areas.
      - LOCKDOWN: Complete isolation. Do not open doors for anyone.

      Requirements:
      1. One immediate safety action.
      2. Clear attribution: "Alert detected from ${triggererName}. Security and neighbors notified."
      3. No generic sectors or coordinates.
      4. Maximum 35 words.`,
      config: {
        temperature: 0.7,
        topP: 0.95,
      }
    });

    return response.text;
  } catch (error) {
    console.error("Gemini Advice Error:", error);
    return FALLBACK_MESSAGE(alertType, triggererName);
  }
};
