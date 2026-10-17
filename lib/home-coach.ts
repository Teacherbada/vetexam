import type {CoachGroup} from './coach-daily';
export type HomeCoachSummary={owner:string|null;enabled:boolean;date?:string;target?:number;todayTotal?:number;task:null|{total:number;answered:number;remaining:number;completed:boolean;groups:{key:CoachGroup;total:number;answered:number;remaining:number}[];review:{total:number;answered:number};compact:null|{total:number;answered:number;completed:boolean;enabled:boolean}};diagnostic?:{answered:number;total:number}|null};
export const noHomeCoach:HomeCoachSummary={owner:null,enabled:false,task:null};
