window.it.skip = (name) => {
  console.log(`Skipping test "${name}"`)
}
window.describe.skip = (name) => {
  console.log(`Skipping all tests in "${name}"`)
}
