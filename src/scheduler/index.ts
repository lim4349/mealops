import cron from 'node-cron';
import { Attachment } from 'botbuilder';
import type {
  Scheduler,
  VoteService,
  VoteRepository,
  UserRepository,
  BlacklistRepository,
  SelectedHistoryRepository,
  SettingRepository,
  RestaurantRepository,
  WeatherService,
} from '../core/types.js';
import { buildVoteCard, buildReviewCard } from '../cards/index.js';

// Define ScheduledTask type locally
interface ScheduledTask {
  stop(): void;
  start(): void;
}

export class SchedulerImpl implements Scheduler {
  private voteTask: ReturnType<typeof cron.schedule> | null = null;
  private decisionTask: ReturnType<typeof cron.schedule> | null = null;
  private reviewTask: ReturnType<typeof cron.schedule> | null = null;

  constructor(
    private voteService: VoteService,
    private voteRepo: VoteRepository,
    private userRepo: UserRepository,
    private blacklistRepo: BlacklistRepository,
    private historyRepo: SelectedHistoryRepository,
    private settingRepo: SettingRepository,
    private restaurantRepo: RestaurantRepository,
    private weatherService: WeatherService,
    private sendNotification: (message: string, card?: Attachment) => Promise<void>
  ) {}

  start(): void {
    const voteHour = process.env.VOTE_HOUR ?? '11';
    const voteMinute = process.env.VOTE_MINUTE ?? '00';
    const reviewHour = process.env.REVIEW_HOUR ?? '12';
    const reviewMinute = process.env.REVIEW_MINUTE ?? '50';
    const forceMinute = parseInt(process.env.FORCE_DECISION_MINUTE ?? '30', 10);

    // Vote reminder at VOTE_HOUR:VOTE_MINUTE
    this.voteTask = cron.schedule(`${voteMinute} ${voteHour} * * 1-5`, async () => {
      if (this.isHoliday(new Date())) {
        console.log('Today is holiday, skipping vote reminder');
        return;
      }
      await this.sendVoteReminder();
    }, {
      timezone: process.env.TIMEZONE ?? 'Asia/Seoul',
    });

    // Force decision at VOTE_HOUR:FORCE_MINUTE
    this.decisionTask = cron.schedule(`${forceMinute} ${voteHour} * * 1-5`, async () => {
      if (this.isHoliday(new Date())) {
        console.log('Today is holiday, skipping force decision');
        return;
      }
      if (!this.settingRepo.getForceDecisionEnabled()) {
        console.log('Force decision is disabled');
        return;
      }
      await this.makeForceDecision();
    }, {
      timezone: process.env.TIMEZONE ?? 'Asia/Seoul',
    });

    // Review reminder disabled
    // this.reviewTask = cron.schedule(`${reviewMinute} ${reviewHour} * * 1-5`, async () => {
    //   if (this.isHoliday(new Date())) {
    //     console.log('Today is holiday, skipping review reminder');
    //     return;
    //   }
    //   await this.sendReviewReminder();
    // }, {
    //   timezone: process.env.TIMEZONE ?? 'Asia/Seoul',
    // });

    console.log('Scheduler started');
  }

  stop(): void {
    this.voteTask?.stop();
    this.decisionTask?.stop();
    this.reviewTask?.stop();
    console.log('Scheduler stopped');
  }

  isHoliday(date: Date): boolean {
    // Check weekends
    const day = date.getDay();
    if (day === 0 || day === 6) return true; // 토일은 휴일

    // 2024-2026년 한국 공휴일 (YYYY-MM-DD)
    const holidays = [
      // 2024
      '2024-01-01', // 신정
      '2024-02-09', // 설날
      '2024-02-10',
      '2024-02-11',
      '2024-02-12',
      '2024-03-01', // 삼일절
      '2024-04-10', // 국회의원 선거일
      '2024-05-05', // 어린이날
      '2024-05-15', // 부처님 오신 날
      '2024-06-06', // 현충일
      '2024-08-15', // 광복절
      '2024-09-16', // 추석
      '2024-09-17',
      '2024-09-18',
      '2024-10-03', // 개천절
      '2024-10-09', // 한글날
      '2024-12-25', // 크리스마스
      // 2025
      '2025-01-01', // 신정
      '2025-01-29', // 설날
      '2025-01-30',
      '2025-01-31',
      '2025-02-01',
      '2025-03-01', // 삼일절
      '2025-04-05', // 식목일
      '2025-05-05', // 어린이날
      '2025-05-06', // 대체휴일
      '2025-05-14', // 부처님 오신 날
      '2025-06-06', // 현충일
      '2025-08-15', // 광복절
      '2025-09-17', // 추석
      '2025-09-18',
      '2025-09-19',
      '2025-10-03', // 개천절
      '2025-10-09', // 한글날
      '2025-12-25', // 크리스마스
      // 2026
      '2026-01-01', // 신정
      '2026-02-17', // 설날
      '2026-02-18',
      '2026-02-19',
      '2026-02-20',
      '2026-03-01', // 삼일절
      '2026-04-04', // 식목일
      '2026-05-05', // 어린이날
      '2026-05-03', // 부처님 오신 날
      '2026-06-06', // 현충일
      '2026-08-15', // 광복절
      '2026-09-07', // 추석
      '2026-09-08',
      '2026-09-09',
      '2026-10-03', // 개천절
      '2026-10-09', // 한글날
      '2026-12-25', // 크리스마스
    ];

    const dateStr = date.toISOString().split('T')[0];
    return holidays.includes(dateStr);
  }

  private async sendVoteReminder(): Promise<void> {
    const today = this.formatDate(new Date());

    // Get delivery mode
    const deliveryModeActive = this.settingRepo.getDeliveryModeActive();
    let restaurants = this.restaurantRepo.findAll();
    if (deliveryModeActive) {
      restaurants = restaurants.filter(r => r.is_delivery);
    }

    // Send vote card
    const voteResults = this.voteService.getResults(today);
    const soloCount = this.voteService.getSoloCount(today);
    const anyCount = this.voteService.getAnyCount(today);
    const uniqueVoterCount = this.voteRepo.countUniqueVoters(today);
    const votersByRestaurant = this.voteRepo.findVotersByRestaurant(today);
    const soloVoters = this.voteRepo.findSoloVoters(today);
    const anyVoters = this.voteRepo.findAnyVoters(today);

    const voteCard = buildVoteCard(
      restaurants,
      voteResults,
      soloCount,
      [],
      false,
      false,
      votersByRestaurant,
      soloVoters,
      anyVoters,
      anyCount,
      uniqueVoterCount,
      deliveryModeActive
    );

    const message = `🍽️ **점심 투표 시간!**

${this.settingRepo.getForceDecisionEnabled() ? `⏰ ${process.env.VOTE_HOUR}:${process.env.FORCE_DECISION_MINUTE || '30'}에 투표 마감됩니다!` : ''}`;

    await this.sendNotification(message, voteCard as any);
  }

  private async makeForceDecision(): Promise<void> {
    const today = this.formatDate(new Date());
    const result = this.voteService.decideWinner(today);

    if (result.success && result.data) {
      await this.sendNotification(`⏰ **투표 마감!**

${result.message}

이유: ${result.data.reason}`);

      // Save to history with weather
      const restaurant = this.restaurantRepo.findByName(result.data.restaurant);
      if (restaurant) {
        const voteResults = this.voteService.getResults(today);
        const totalVotes = voteResults.reduce((sum, r) => sum + r.count, 0);

        // Get current weather
        const weather = await this.weatherService.getCurrent();

        this.historyRepo.add(restaurant.id, today, totalVotes, weather.temp, weather.condition);
      }
    }
  }

  private async sendReviewReminder(): Promise<void> {
    const today = this.formatDate(new Date());

    // Get the selected restaurant for today
    const selected = this.historyRepo.findByDate(today);
    if (!selected) {
      console.log('오늘 선택된 식당이 없어서 리뷰 알림 스킵');
      return;
    }

    const restaurant = this.restaurantRepo.findById(selected.restaurant_id);
    if (!restaurant) {
      return;
    }

    const reviewCard = buildReviewCard(restaurant.name);
    const message = `⭐ **식사 리뷰 시간!**`;

    await this.sendNotification(message, reviewCard as any);
  }

  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }
}
