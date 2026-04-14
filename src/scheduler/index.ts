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
import { formatKstDate, formatKstTime, getKstWeekday } from '../utils/date.js';

// Define ScheduledTask type locally
interface ScheduledTask {
  stop(): void;
  start(): void;
}

export class SchedulerImpl implements Scheduler {
  private voteTask: ReturnType<typeof cron.schedule> | null = null;
  private decisionTask: ReturnType<typeof cron.schedule> | null = null;
  private reviewTask: ReturnType<typeof cron.schedule> | null = null;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

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

  private lastVoteKey = '';
  private lastDecisionKey = '';
  private lastReviewKey = '';

  start(): void {
    const voteHour = process.env.VOTE_HOUR ?? '11';
    const voteMinute = process.env.VOTE_MINUTE ?? '00';
    const forceMinute = String(parseInt(process.env.FORCE_DECISION_MINUTE ?? '30', 10)).padStart(2, '0');
    const reviewHour = process.env.REVIEW_HOUR ?? '12';
    const reviewMinute = process.env.REVIEW_MINUTE ?? '50';

    console.log(`⏰ Scheduler config: VOTE=${voteHour}:${voteMinute}, FORCE=${voteHour}:${forceMinute}, REVIEW=${reviewHour}:${reviewMinute}`);

    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
    }

    // 매초 확인 (KST 기준)
    let debugCount = 0;
    this.intervalHandle = setInterval(async () => {
      const now = new Date();
      const today = formatKstDate(now);
      const hm = formatKstTime(now);
      const weekday = getKstWeekday(now);

      // 디버그: 10초마다 출력
      debugCount++;
      if (debugCount % 10 === 0) {
        console.log(`[DEBUG] 현재: ${today} ${hm}, VOTE: ${voteHour}:${voteMinute}, lastVote: ${this.lastVoteKey}`);
      }

      const voteKey = `${today}|vote|${hm}`;
      const decisionKey = `${today}|decision|${hm}`;
      const reviewKey = `${today}|review|${hm}`;
      const isWeekday = weekday >= 1 && weekday <= 5;
      const isHoliday = this.isHoliday(now);

      // 투표 알림 (평일만, KST 기준)
      if (hm === `${voteHour}:${voteMinute}` && this.lastVoteKey !== voteKey && isWeekday) {
        this.lastVoteKey = voteKey;
        console.log(`[VOTE] 스케줄 실행: ${voteHour}:${voteMinute}`);
        if (!isHoliday) {
          await this.sendVoteReminder();
        }
      }

      // 강제 결정 (평일만, KST 기준)
      if (hm === `${voteHour}:${forceMinute}` && this.lastDecisionKey !== decisionKey && isWeekday) {
        this.lastDecisionKey = decisionKey;
        console.log(`[FORCE] 스케줄 실행: ${voteHour}:${forceMinute}`);
        if (!isHoliday && this.settingRepo.getForceDecisionEnabled()) {
          await this.makeForceDecision();
        }
      }

      if (hm === `${reviewHour}:${reviewMinute}` && this.lastReviewKey !== reviewKey && isWeekday) {
        this.lastReviewKey = reviewKey;
        console.log(`[REVIEW] 스케줄 실행: ${reviewHour}:${reviewMinute}`);
        if (!isHoliday) {
          await this.sendReviewReminder();
        }
      }
    }, 1000); // 1초마다 확인

    console.log('Scheduler started (setInterval mode)');
  }

  stop(): void {
    this.voteTask?.stop();
    this.decisionTask?.stop();
    this.reviewTask?.stop();
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
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

    const dateStr = formatKstDate(date);
    return holidays.includes(dateStr);
  }

  private async sendVoteReminder(): Promise<void> {
    const today = this.formatDate(new Date());
    const voteHour = process.env.VOTE_HOUR ?? '11';
    const forceMinute = String(parseInt(process.env.FORCE_DECISION_MINUTE ?? '30', 10)).padStart(2, '0');

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

    const allUserIds = this.userRepo.findAll().map(u => u.id);

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
      deliveryModeActive,
      undefined,
      allUserIds
    );

    const message = `🍽️ **점심 투표 시간!**

${this.settingRepo.getForceDecisionEnabled() ? `⏰ ${voteHour}:${forceMinute}에 투표 마감됩니다!` : ''}`;

    await this.sendNotification(message, voteCard as any);
  }

  private async makeForceDecision(): Promise<void> {
    const today = this.formatDate(new Date());
    const existingHistory = this.historyRepo.findByDate(today);
    if (existingHistory) {
      console.log(`[FORCE] ${today} 이미 메뉴가 결정되어 강제결정을 건너뜁니다.`);
      return;
    }

    const result = this.voteService.decideWinner(today);

    if (result.success && result.data) {
      await this.sendNotification(`⏰ **투표 마감!**

${result.message}

이유: ${result.data.reason}`);

      // Save to history with weather
      const restaurant = this.restaurantRepo.findByName(result.data.restaurant);
      if (restaurant) {
        const voteResults = this.voteService.getResults(today);
        const winnerVotes = voteResults.find(r => r.restaurant_id === restaurant.id)?.count ?? 0;

        // Get current weather
        const weather = await this.weatherService.getCurrent();

        this.historyRepo.add(restaurant.id, today, winnerVotes, weather.temp, weather.condition);
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
    return formatKstDate(date);
  }
}
