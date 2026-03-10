// 批量编辑测试文件
// 用于手动测试 fast-edit 精华功能

function oldFunction1() {
  console.log('old 1')
  return 1
}

function oldFunction2() {
  console.log('old 2')
  return 2
}

function oldFunction3() {
  console.log('old 3')
  return 3
}

const config = {
  setting1: 'value1',
  setting2: 'value2',
  setting3: 'value3'
}

function oldFunction4() {
  console.log('old 4')
  return 4
}

function oldFunction5() {
  console.log('old 5')
  return 5
}

// 测试场景说明：
// 1. 批量替换：一次性修改 oldFunction1, oldFunction3, oldFunction5
// 2. 混合操作：删除 oldFunction2，插入新函数，修改 oldFunction4
// 3. 警告检测：故意制造重复行或括号不平衡
