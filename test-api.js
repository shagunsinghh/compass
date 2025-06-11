// test-api.js - Run this to test your API setup
// Save this as test-api.js and run with: node test-api.js

const testAPI = async () => {
  console.log("🧪 Testing API setup...\n");

  // Test 1: Basic API endpoint
  try {
    const response = await fetch("http://localhost:3000/api/test");
    const data = await response.json();
    console.log("✅ Test endpoint working:", data);
  } catch (error) {
    console.log("❌ Test endpoint failed:", error.message);
    console.log("   Make sure your server is running on port 3000");
    return;
  }

  // Test 2: OpenAI API endpoint
  try {
    const response = await fetch("http://localhost:3000/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pdfText:
          "This is a test research study about machine learning for medical diagnosis. The principal investigator is Dr. John Smith from MIT. The study aims to improve diagnostic accuracy using AI.",
      }),
    });

    if (response.ok) {
      const data = await response.json();
      console.log("✅ OpenAI API endpoint working");
      console.log(
        "   Response preview:",
        data.choices?.[0]?.message?.content?.substring(0, 100) + "..."
      );
    } else {
      const errorData = await response.json();
      console.log("❌ OpenAI API endpoint failed:", errorData.error);
    }
  } catch (error) {
    console.log("❌ OpenAI API test failed:", error.message);
  }
};

// Run the test
testAPI();
