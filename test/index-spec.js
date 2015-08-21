var Greeter = require("../lib/index");

describe("index", function () {
  it("should greet with message", function () {
    var greeter = new Greeter('friend');
    expect(greeter.greet()).toBe('Bonjour, friend!');
  });
});
