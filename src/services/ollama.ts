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
          temperature: 1.0,
          num_predict: 500,
        },
      }, { timeout: 120000 });

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
      .map(r => `${r.name}(${r.category}, ${r.distance}m${r.tags ? ', ' + r.tags : ''})`)
      .join(', ');

    const weatherInstruction = this.buildWeatherInstruction(context.weather);

    const prevLine = context.previousRecommendations?.length
      ? `\n\n⚠️ 절대금지(다시 추천금지): ${context.previousRecommendations.join(', ')}\n이들 대신 다른 식당을 추천하세요.`
      : '';

    const reasonExample = this.buildReasonInstruction(context.weather);
    const userRequestLine = context.userRequest
      ? `\n사용자 요청: "${context.userRequest}" - 이 조건을 최우선으로 반영하세요.`
      : '';

    return `당신은 점심 식당 추천 AI입니다. 반드시 한국어로만 답하세요.

날씨: ${context.weather.temp}도 ${context.weather.description}. ${weatherInstruction}.${userRequestLine}
식당 목록: ${restaurantList}
제외(최근3일): ${context.recentVisits.join(', ') || '없음'}
제외(블랙리스트): ${context.blacklisted.join(', ') || '없음'}${prevLine}

규칙:
1. 위 식당 목록에서만 정확히 5개 추천 (반드시 5개)
2. 각각 다른 카테고리 우선${context.userRequest ? '\n3. 사용자 요청 조건에 맞는 식당 우선 선택' : ''}
${context.userRequest ? '4' : '3'}. reason은 반드시 한국어로, 10자 이내 키워드만 (문장 금지), 예시: "${reasonExample}"
${context.userRequest ? '5' : '4'}. JSON 배열만 출력, 다른 텍스트 금지

[{"name":"식당이름","reason":"짧은키워드"},...]`;
  }

  private buildReasonInstruction(weather: import('../core/types.js').WeatherInfo): string {
    const condition = weather.condition.toLowerCase();
    if (condition.includes('rain') || condition.includes('snow')) {
      return '비오는날 · 가까운거리';
    }
    if (weather.temp < 10) return '추운날 · 따뜻한국물';
    if (weather.temp > 25) return '더운날 · 시원한메뉴';
    return '오늘날씨 · 추천이유';
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

  async generateTags(name: string, category: string): Promise<string> {
    try {
      const response = await axios.post(`${this.baseUrl}/api/generate`, {
        model: this.model,
        prompt: `식당 이름: "${name}" (카테고리: ${category})
이 식당의 음식 특징을 한국어 태그로 추정하세요.
규칙:
1. 쉼표로 구분된 태그만 출력 (다른 텍스트 금지)
2. 3~6개 태그
3. 예시 태그: 매운맛,국물,고기,해산물,채식,달콤,담백,볶음,튀김,면류,밥류,빠름,혼밥가능 (가격 관련 태그 금지)
4. 출력 예시: 매운맛,국물,고기,밥류`,
        stream: false,
        options: { temperature: 0.3, num_predict: 50 },
      }, { timeout: 30000 });

      const raw = (response.data.response as string).trim();
      // 쉼표로 구분된 태그만 추출 (한글/쉼표 외 제거)
      const tags = raw.replace(/[^가-힣a-zA-Z0-9,]/g, '').split(',').filter(t => t.length > 0).slice(0, 6).join(',');
      console.log(`[Ollama] 태그 생성: ${name} → ${tags}`);
      return tags;
    } catch {
      return '';
    }
  }

  async warmup(): Promise<void> {
    try {
      await axios.post(`${this.baseUrl}/api/generate`, {
        model: this.model,
        prompt: '안녕',
        stream: false,
        options: { num_predict: 1 },
      }, { timeout: 120000 });
    } catch {
      // warmup 실패해도 무시
    }
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
