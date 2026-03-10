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
          temperature: 0.7,
          num_predict: 500,
        },
      }, { timeout: 30000 });

      const raw = response.data.response;
      console.log(`[Ollama] 응답 원문: ${raw.slice(0, 300)}`);
      return this.parseResponse(raw);
    } catch (error) {
      console.error('Ollama error:', error);
      // Fallback to simple recommendations
      return this.getFallbackRecommendations(context);
    }
  }

  private buildPrompt(context: RecommendationContext): string {
    const restaurantList = context.availableRestaurants
      .map(r => `${r.name}(${r.category}, ${r.distance}m)`)
      .join(', ');

    const weatherInstruction = this.buildWeatherInstruction(context.weather);

    const prevLine = context.previousRecommendations?.length
      ? `\n이전과 다르게(최대한 제외): ${context.previousRecommendations.join(', ')}`
      : '';

    return `날씨: ${context.weather.temp}도 ${context.weather.description}. ${weatherInstruction}.
식당 목록: ${restaurantList}
제외(최근): ${context.recentVisits.join(', ') || '없음'}
제외(블랙): ${context.blacklisted.join(', ') || '없음'}
우선추천: ${context.topRated.slice(0, 5).join(', ') || '없음'}${prevLine}

위 식당 목록에서만 5개 추천. JSON만 출력:
[{"name":"식당이름","reason":"날씨/음식 특성 위주로 짧게"},...]`;
  }

  private buildWeatherInstruction(weather: import('../core/types.js').WeatherInfo): string {
    const temp = weather.temp;
    const condition = weather.condition.toLowerCase();

    if (condition.includes('rain') || condition.includes('snow')) {
      return '비/눈이 오므로 거리가 가깝고 실내 편한 식당 우선 추천';
    }
    if (temp < 10) {
      return '추운 날씨이므로 따뜻한 한식/국물류 우선 추천';
    }
    if (temp > 25) {
      return '더운 날씨이므로 시원한 냉면/국수류/음료 우선 추천';
    }
    return '날씨가 좋으니 다양한 선택지에서 평점 높은 식당 추천';
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
    const isCold = context.weather.temp < 10 || context.weather.condition.toLowerCase().includes('rain') || context.weather.condition.toLowerCase().includes('snow');
    const isHot = context.weather.temp > 25;

    const reasonByCondition = isCold
      ? '추운 날 따뜻한 메뉴'
      : isHot
      ? '더운 날 시원한 메뉴'
      : '오늘 날씨에 어울리는 메뉴';

    // Shuffle available restaurants and return up to 5
    const available = [...context.availableRestaurants];
    for (let i = available.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [available[i], available[j]] = [available[j], available[i]];
    }

    return available.slice(0, 5).map(r => ({
      name: r.name,
      reason: `${reasonByCondition} · ${r.category} · ${r.distance}m`,
    }));
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
