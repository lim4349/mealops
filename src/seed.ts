import 'dotenv/config';
import { getDatabase } from './db/index.js';
import { RestaurantRepositoryImpl } from './repositories/index.js';
import type { CreateRestaurantDto } from './core/types.js';

const db = getDatabase();
db.init();

const restaurantRepo = new RestaurantRepositoryImpl(db);

const dummyRestaurants: CreateRestaurantDto[] = [
  // 한식
  { name: '국수나무 강남점', category: '한식', distance: 300, price: 10000 },
  { name: '서가앤쿡 강남역점', category: '한식', distance: 250, price: 12000 },
  { name: '이춘복닭발 강남점', category: '한식', distance: 400, price: 15000 },
  { name: '본죽 강남점', category: '한식', distance: 180, price: 9000 },
  { name: '빕스 강남점', category: '한식', distance: 350, price: 14000 },
  // 일식
  { name: '스시로우 강남점', category: '일식', distance: 350, price: 18000 },
  { name: '오토바이 강남점', category: '일식', distance: 320, price: 14000 },
  { name: '이자카야 강남', category: '일식', distance: 400, price: 16000 },
  // 중식
  { name: '짜장명가 강남점', category: '중식', distance: 200, price: 11000 },
  { name: '홍콩반점0410 강남점', category: '중식', distance: 280, price: 13000 },
  // 양식
  { name: '미스터피자 강남점', category: '양식', distance: 500, price: 15000 },
  { name: '파스쿠치 강남역점', category: '양식', distance: 450, price: 16000 },
  { name: '한스이츠 강남점', category: '양식', distance: 400, price: 17000 },
  // 분식
  { name: '김밥천국 강남역점', category: '분식', distance: 150, price: 8000 },
  { name: '떡볶이전문점 강남', category: '분식', distance: 200, price: 9000 },
];

async function seed() {
  console.log('🌱 Seeding restaurants...');

  for (const dto of dummyRestaurants) {
    try {
      const existing = restaurantRepo.findByName(dto.name);
      if (existing) {
        console.log(`⊙ ${dto.name} - already exists`);
      } else {
        restaurantRepo.create(dto);
        console.log(`✅ ${dto.name} - added`);
      }
    } catch (error) {
      console.error(`❌ ${dto.name} - failed: ${(error as Error).message}`);
    }
  }

  const all = restaurantRepo.findAll();
  console.log(`\n📊 Total restaurants: ${all.length}`);

  db.close();
}

seed().catch(console.error);
