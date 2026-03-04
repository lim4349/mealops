import axios from 'axios';
import type { OllamaService, RecommendationContext, RecommendationResult } from '../core/types.js';

export class OllamaServiceImpl implements OllamaService {
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(baseUrl: string = 'http://localhost:11434', model: string = 'gemma3:12b') {
    this.baseUrl = baseUrl;
    this.model = model;
  }

  async recommend(context: RecommendationContext): Promise<RecommendationResult[]> {
    try {
      const prompt = this.buildPrompt(context);

      const response = await axios.post(`${this.baseUrl}/api/generate`, {
        model: this.model,
        prompt,
        stream: false,
        options: {
          temperature: 0.8,
          num_predict: 500,
        },
      });

      return this.parseResponse(response.data.response);
    } catch (error) {
      console.error('Ollama error:', error);
      // Fallback to simple recommendations
      return this.getFallbackRecommendations(context);
    }
  }

  private buildPrompt(context: RecommendationContext): string {
    return `오늘 강남역 날씨는 ${context.weather.temp}도, ${context.weather.description}입니다.

최근 먹었던 식당: ${context.recentVisits.join(', ') || '없음'}
평점이 높은 식당: ${context.topRated.join(', ') || '없음'}
블랙리스트: ${context.blacklisted.join(', ') || '없음'}
예산: 1인 ${context.budget}원

다음 조건으로 점심 메뉴 5개를 추천해주세요:
1. 블랙리스트에 있는 식당 제외
2. 최근 3일 이내에 먹었던 식당 제외
3. 날씨 고려 (추우면 따뜻한 한식/찌개류, 더우면 시원한 국수/돈까스)
4. 평점과 다양성 고려

반드시 JSON 배열 형식으로만 답변해주세요. 다른 말은 하지 말고 JSON만:
[
  {"name": "식당이름", "reason": "추천 이유 (짧게)"},
  ...
]`;
  }

  private parseResponse(text: string): RecommendationResult[] {
    try {
      // Try to extract JSON from response
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return parsed.map((item: unknown) => ({
          name: (item as { name: string }).name,
          reason: (item as { reason: string }).reason,
        }));
      }
    } catch (e) {
      console.error('Failed to parse Ollama response:', e);
    }
    return [];
  }

  private getFallbackRecommendations(context: RecommendationContext): RecommendationResult[] {
    // Simple fallback based on weather
    const isCold = context.weather.temp < 10 || context.weather.condition.includes('rain');
    const isHot = context.weather.temp > 25;

    const recommendations: RecommendationResult[] = [];

    if (isCold) {
      recommendations.push({ name: '본죽', reason: '추운 날 따뜻한 죽이 최고입니다' });
      recommendations.push({ name: '서가앤쿡', reason: '따뜻한 한식 한그릇' });
    } else if (isHot) {
      recommendations.push({ name: '국수나무', reason: '더운 날 시원한 국수' });
      recommendations.push({ name: '미스터피자', reason: '에어컨 빵빵한 양식' });
    } else {
      recommendations.push({ name: '빕스', reason: '적당한 날씨에 좋은 양식' });
    }

    return recommendations.slice(0, 5);
  }

  async checkConnection(): Promise<boolean> {
    try {
      await axios.get(`${this.baseUrl}/api/tags`, { timeout: 2000 });
      return true;
    } catch {
      return false;
    }
  }
}
