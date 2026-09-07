// 闖關任務清單。
//
// `folder` is what guests will see in Google Drive, so it stays short: long
// names get truncated in Drive's grid view on phones. `title` (and the
// optional `detail`) is what the guest reads on the phone before uploading.

export interface Mission {
  id: string        // 網址/表單用的代號
  label: string     // 清單左側編號徽章
  folder: string    // Drive 資料夾名稱：『任務1 鬼臉合照』
  title: string
  detail?: string
}

export const MISSIONS: Mission[] = [
  { id: '1',  label: '1',  folder: '任務1 鬼臉合照',    title: '和新郎、新娘一起扮鬼臉合照' },
  { id: '2',  label: '2',  folder: '任務2 愛心合照',    title: '和新郎、新娘一起比愛心合照' },
  { id: '3',  label: '3',  folder: '任務3 祝福錄影',    title: '錄一段給新郎新娘的祝福語', detail: '找一個好看的背景' },
  { id: '4',  label: '4',  folder: '任務4 佈置採訪',    title: '當個記者，採訪五個人', detail: '『這場婚禮佈置的如何？最喜歡哪裡？』' },
  { id: '5',  label: '5',  folder: '任務5 新朋友拍貼',  title: '找一位第一次見面的賓客，合照一張拍貼機' },
  { id: '6',  label: '6',  folder: '任務6 最醉的人',    title: '找到今天喝最醉的人，跟他合照' },
  { id: '7',  label: '7',  folder: '任務7 偷拍新人',    title: '拍一張『新郎新娘完全不知道你在拍他們』的瞬間' },
  { id: '8',  label: '8',  folder: '任務8 新人親親',    title: '拍一張『新郎新娘親親』的瞬間' },
  { id: '9',  label: '9',  folder: '任務9 對你笑',      title: '拍一張『新郎新娘對你笑』的瞬間' },
  { id: '10', label: '10', folder: '任務10 新郎最帥',   title: '拍一張『新郎最帥』的瞬間獨照' },
  { id: '11', label: '11', folder: '任務11 新娘最美',   title: '拍一張『新娘最美』的瞬間獨照' },
  { id: '12', label: '12', folder: '任務12 模仿大愛心', title: '找個人模仿照片姿勢拍照（大愛心）' },
  { id: '13', label: '13', folder: '任務13 模仿鬼臉',   title: '找個人模仿照片姿勢拍照（鬼臉）' },
  { id: '14', label: '14', folder: '任務14 模仿背背',   title: '找個人模仿照片姿勢拍照（背背）' },
  { id: '15', label: '15', folder: '任務15 模仿親親',   title: '找個人模仿照片姿勢拍照（親親）' },
  { id: '16', label: '16', folder: '任務16 道歉採訪',   title: '當個記者，採訪五個人', detail: '『如果新郎未來生活上惹新娘生氣，建議新郎要用什麼方式道歉？』' },
  { id: '17', label: '17', folder: '任務17 名模走秀',   title: '找新郎新娘一起拍一段名模走秀＋end pose 的影片' },
  { id: '18', label: '18', folder: '任務18 同學對比',   title: '找所有高中同學／老師，拍下過去現在對比', detail: '香菇專屬' },
  { id: '19', label: '19', folder: '任務19 三十簽名',   title: '給 30 個人簽名，並拍下第一人稱短影音', detail: '華軒專屬' },
  { id: '20', label: '20', folder: '任務20 二十灌酒',   title: '給 20 個人灌酒，並拍下第一人稱短影音', detail: '路比專屬' },
  { id: 'b1', label: '備1', folder: '備用1 模仿婚紗照', title: '找個人模仿現場婚紗照姿勢拍照' },
  { id: 'b2', label: '備2', folder: '備用2 電影海報',   title: '用 AI 幫新人製作一張有創意的電影海報' },
  { id: 'b3', label: '備3', folder: '備用3 質感角落',   title: '找出會場裡你覺得最有質感的角落，拍一張' },
  { id: 'b4', label: '備4', folder: '備用4 最喜歡的花', title: '找出會場裡你覺得最喜歡的花，拍一張' },
  { id: 'b5', label: '備5', folder: '備用5 最愛的食物', title: '找出會場裡你覺得最喜歡的食物，拍一張' },
  { id: 'b6', label: '備6', folder: '備用6 小朋友祝福', title: '請現場一位小朋友對鏡頭說一句祝福', detail: '記得先問過爸拔媽麻' },
  { id: 'b7', label: '備7', folder: '備用7 夫妻訪問',   title: '採訪在場一對夫妻：『婚姻長久的秘訣？』' },
]

export function findMission(id: string): Mission | undefined {
  return MISSIONS.find((m) => m.id === id)
}
