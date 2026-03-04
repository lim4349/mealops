import axios from 'axios';
import type { WeatherService, WeatherInfo } from '../core/types.js';

export class WeatherServiceImpl implements WeatherService {
  private readonly apiKey: string;
  private readonly city: string;

  constructor(apiKey: string, city: string = 'Seoul') {
    this.apiKey = apiKey;
    this.city = city;
  }

  async getCurrent(): Promise<WeatherInfo> {
    if (!this.apiKey) {
      return this.getDefaultWeather();
    }

    try {
      const response = await axios.get(
        `https://api.openweathermap.org/data/2.5/weather?q=${this.city}&appid=${this.apiKey}&units=metric&lang=kr`
      );

      const weather = response.data.weather[0];
      return {
        temp: Math.round(response.data.main.temp),
        condition: weather.main.toLowerCase(),
        description: weather.description,
      };
    } catch (error) {
      console.error('Weather API error:', error);
      return this.getDefaultWeather();
    }
  }

  private getDefaultWeather(): WeatherInfo {
    // Default to mild weather
    return {
      temp: 18,
      condition: 'clear',
      description: '맑음',
    };
  }
}

// Simple fallback without API key
export class MockWeatherService implements WeatherService {
  async getCurrent(): Promise<WeatherInfo> {
    const hour = new Date().getHours();
    const month = new Date().getMonth() + 1;

    // Seasonal mock
    let temp = 18;
    let description = '맑음';

    if (month >= 12 || month <= 2) {
      temp = 5;
      description = '추움';
    } else if (month >= 3 && month <= 5) {
      temp = 15;
      description = '따뜻함';
    } else if (month >= 6 && month <= 8) {
      temp = 28;
      description = '더움';
    } else {
      temp = 18;
      description = '선선함';
    }

    return { temp, condition: 'clear', description };
  }
}
