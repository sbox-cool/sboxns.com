global using Microsoft.VisualStudio.TestTools.UnitTesting;
using Sandbox;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Sboxns.Certification;

[AttributeUsage(AttributeTargets.Method, AllowMultiple = true)]
public sealed class CoversAttribute(Type type, string name, params string[] parameters) : Attribute
{
    public MethodInfo Resolve()
    {
        var methods = type.GetMethods(BindingFlags.Public | BindingFlags.Static | BindingFlags.Instance | BindingFlags.DeclaredOnly).Where(method => method.Name == name);
        if (parameters.Length > 0) methods = methods.Where(method => method.GetParameters().Select(parameter => parameter.ParameterType.ToString()).SequenceEqual(parameters));
        return methods.Single(); // Ambiguous overloads must be identified, never credited together.
    }
}

[TestClass]
public sealed class NativeEvidence
{
    static TestAppSystem app;
    static readonly List<object> scenarios = [];
    static readonly DateTimeOffset started = DateTimeOffset.UtcNow;
    static readonly JsonSerializerOptions json = new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };
    public static string Env(string name) => Environment.GetEnvironmentVariable(name) is { Length: > 0 } value ? value : throw new InvalidOperationException($"Missing {name}");
    public static string Signature(MethodInfo method) => method.DeclaringType.FullName + "::" + method;

    [AssemblyInitialize]
    public static void Start(TestContext context)
    {
        app = new TestAppSystem();
        app.Init();
    }

    public static void Record(TestContext context)
    {
        var test = typeof(ClientTests).GetMethod(context.TestName);
        var methods = test.GetCustomAttributes<CoversAttribute>().Select(attribute => Signature(attribute.Resolve()))
            .Append(Signature(typeof(NetworkStorage).GetMethods().Single(method => method.Name == "Configure"))).Distinct().ToArray();
        scenarios.Add(new { id = context.TestName, methods, result = context.CurrentTestOutcome == UnitTestOutcome.Passed ? "pass" : context.CurrentTestOutcome == UnitTestOutcome.Inconclusive || context.CurrentTestOutcome == UnitTestOutcome.NotRunnable ? "skipped" : "fail" });
    }

    [AssemblyCleanup]
    public static void Stop()
    {
        try
        {
            var inventory = typeof(NetworkStorage).Assembly.GetExportedTypes().Where(type => type.Namespace == "Sandbox")
                .SelectMany(type => type.GetMethods(BindingFlags.Public | BindingFlags.Static | BindingFlags.Instance | BindingFlags.DeclaredOnly))
                .Where(method => !method.IsSpecialName).Select(Signature).Distinct().Order(StringComparer.Ordinal).ToArray();
            var identity = JsonNode.Parse(File.ReadAllText(Env("NS_CERT_IDENTITY")));
            identity["suite"]["inventorySha256"] = Convert.ToHexStringLower(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(JsonSerializer.Serialize(inventory, json))));
            identity["library"]["artifactSha256"] = Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes(typeof(NetworkStorage).Assembly.Location)));
            identity["os"] = System.Runtime.InteropServices.RuntimeInformation.OSDescription;
            var output = Env("NS_CERT_OUTPUT");
            File.WriteAllText(Path.Combine(output, "inventory.json"), JsonSerializer.Serialize(inventory, json));
            File.WriteAllText(Path.Combine(output, "expected.json"), identity.ToJsonString(json));
            File.WriteAllText(Path.Combine(output, "native-report.json"), JsonSerializer.Serialize(new {
                identity, runtime = "sbox-native", compilation = identity["library"]!["compilation"]!.GetValue<string>(), startedAt = started,
                finishedAt = DateTimeOffset.UtcNow, evidence = Array.Empty<string>(), scenarios,
            }, json));
        }
        finally { app.Shutdown(); }
    }
}
