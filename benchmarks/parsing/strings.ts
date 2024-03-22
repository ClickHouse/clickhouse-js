/*
From https://stackoverflow.com/a/37037034/4575540

Checked with Node.js 20 - no difference.

strConcat
128888890 - 238ms
strTemplate
128888890 - 235ms
strConcat
128888890 - 234ms
strTemplate
128888890 - 228ms

 */
void (() => {
  function strConcat(i: number) {
    return 'abc' + i + 'def'
  }

  function strTemplate(i: number) {
    return `abc${i}def`
  }

  function run(strategy: (i: number) => string) {
    const before = new Date().getTime()
    let len = 0
    for (let i = 0; i < 10000000; i += 1) {
      len += strategy(i).length
    }
    console.log(len + ' - ' + (new Date().getTime() - before) + 'ms')
  }

  for (let i = 0; i < 10; i++) {
    console.log('strConcat')
    run(strConcat)

    console.log('strTemplate')
    run(strTemplate)
  }
})()
