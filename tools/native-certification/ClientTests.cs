using Sandbox;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading.Tasks;

namespace Sboxns.Certification;

[TestClass]
public sealed class ClientTests
{
    public TestContext TestContext { get; set; }
    [TestInitialize]
    public void Configure() => NetworkStorage.Configure(NativeEvidence.Env("NS_E2E_PROJECT"), NativeEvidence.Env("NS_E2E_KEY"), NativeEvidence.Env("NS_E2E_BASEURL"));
    [TestCleanup]
    public void Record() => NativeEvidence.Record(TestContext);

    static JsonElement Success(JsonElement? value)
    {
        Assert.IsTrue(value.HasValue, "Real client returned no successful response");
        return value.Value;
    }
    static async Task AssertGold(int expected)
    {
        var document = Success(await NetworkStorage.GetDocument("players", Game.SteamId.ToString()));
        Assert.AreEqual(expected, document.GetProperty("gold").GetInt32());
    }

    [TestMethod]
    [Covers(typeof(NetworkStorage), "SaveDocument")]
    [Covers(typeof(NetworkStorage), "SetDocument")]
    [Covers(typeof(NetworkStorage), "UpdateDocument", "System.String", "System.String", "Sandbox.NetworkStorageOperation[]")]
    [Covers(typeof(NetworkStorage), "UpdateDocument", "System.String", "System.String", "System.Collections.Generic.IEnumerable`1[Sandbox.NetworkStorageOperation]")]
    [Covers(typeof(NetworkStorage), "PatchDocument")]
    [Covers(typeof(NetworkStorage), "GetDocument")]
    [Covers(typeof(NetworkStorage), "DeleteDocument")]
    [Covers(typeof(NetworkStorageOperation), "Increment")]
    [Covers(typeof(NetworkStorageOperation), "Set")]
    public async Task DocumentsPersistEveryOperationAndDelete()
    {
        var player = Game.SteamId.ToString();
        Success(await NetworkStorage.SaveDocument("players", player, new { gold = 100, playerName = "native-first" }));
        await AssertGold(100);
        Success(await NetworkStorage.SetDocument("players", player, new { gold = 200, playerName = "native-replaced" }));
        await AssertGold(200);
        Success(await NetworkStorage.UpdateDocument("players", player, NetworkStorageOperation.Increment("gold", 25), NetworkStorageOperation.Set("playerName", "native-updated")));
        await AssertGold(225);
        Success(await NetworkStorage.UpdateDocument("players", player, (IEnumerable<NetworkStorageOperation>)new[] { NetworkStorageOperation.Increment("gold", 10) }));
        await AssertGold(235);
        Success(await NetworkStorage.PatchDocument("players", player, NetworkStorageOperation.Increment("gold", 2)));
        await AssertGold(237);
        Assert.AreEqual("native-updated", Success(await NetworkStorage.GetDocument("players", player)).GetProperty("playerName").GetString());
        Success(await NetworkStorage.DeleteDocument("players", player));
        Assert.IsFalse((await NetworkStorage.GetDocument("players", player)).HasValue, "Deleted document is still readable");
    }

    [TestMethod]
    [Covers(typeof(NetworkStorage), "CallEndpoint")]
    public async Task EndpointWritesAreVisibleThroughTheClient()
    {
        Success(await NetworkStorage.CallEndpoint("save-profile", new { playerName = "native-certification" }));
        StringAssert.Contains(Success(await NetworkStorage.CallEndpoint("load-profile")).GetRawText(), "native-certification");
    }

    [TestMethod]
    [Covers(typeof(NetworkStorage), "CallEndpoint")]
    [Covers(typeof(NetworkStorage), "TryGetLastEndpointError")]
    public async Task EndpointFailurePreservesTheHttpStatus()
    {
        Assert.IsFalse((await NetworkStorage.CallEndpoint("mine-ore", new { amount = -1 })).HasValue);
        Assert.IsTrue(NetworkStorage.TryGetLastEndpointError("mine-ore", out var code, out var message));
        Assert.AreEqual("HTTP_ERROR", code);
        StringAssert.Contains(message, "400");
    }

    [TestMethod]
    [Covers(typeof(NetworkStorageRevisionInit), "SendInitAsync")]
    public async Task UnsyncedProjectInitializesWithoutForcingAnUpgrade()
    {
        var result = await NetworkStorageRevisionInit.SendInitAsync();
        Assert.IsTrue(result.Ok, result.Message);
        Assert.IsFalse(result.IsOutdatedRevision);
    }
}
